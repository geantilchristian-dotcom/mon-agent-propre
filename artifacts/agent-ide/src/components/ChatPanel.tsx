```tsx
import React, { useState, useRef, useEffect, useCallback } from "react";
import hljs from "highlight.js";
import { useResetChat } from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Send, RotateCcw, Bot, FileCode, Check, Zap, Copy,
  GitCommit, FilePlus, FilePen, FileX, ExternalLink, Paperclip, X, Square,
  Activity, CheckCircle2, Cpu, ShieldCheck, CloudUpload, Ban, History, // Ajout de History
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Font constants                                                      */
/* ------------------------------------------------------------------ */

const SANS = "'Inter', 'Segoe UI', system-ui, sans-serif";
const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";

/* ------------------------------------------------------------------ */
/*  Props / Types                                                       */
/* ------------------------------------------------------------------ */

interface ChatPanelProps {
  currentPath: string | null;
  repo: string;
  onApplyCode?: (code: string) => void;
  onAgentCommit?: () => void;
}

type ModelChoice = "auto" | "claude" | "gpt" | "groq" | "gemini";

interface FileDiff {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
  isDeleted: boolean;
}

interface Message {
  role: "user" | "agent";
  content: string;
  contextFile?: string;
  filesChanged?: string[];
  diffs?: FileDiff[];
  commitSha?: string;
  model?: string;
  suggestions?: string[];
  imageDataUrl?: string;
}

/* ------------------------------------------------------------------ */
/*  Copy button                                                         */
/* ------------------------------------------------------------------ */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={handle}
      title="Copier"
      style={{ fontFamily: SANS }}
      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors
        ${copied ? "text-green-400" : "text-zinc-400 hover:text-white"}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copié !" : "Copier"}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Code block with syntax highlighting                                 */
/* ------------------------------------------------------------------ */

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const highlighted = useCallback(() => {
    if (!lang) return null;
    try {
      const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
      return result.value;
    } catch {
      try {
        const result = hljs.highlightAuto(code);
        return result.value;
      } catch {
        return null;
      }
    }
  }, [lang, code]);

  return (
    <pre className="relative rounded-md overflow-hidden text-xs" style={{ fontFamily: MONO, background: "#161b22", border: "1px solid #21262d" }}>
      <div className="absolute top-1 right-1">
        <CopyButton text={code} />
      </div>
      <code
        className={`hljs language-${lang}`}
        dangerouslySetInnerHTML={{ __html: highlighted() || code }}
        style={{ padding: 10, display: "block", overflowX: "auto" }}
      />
    </pre>
  );
}

/* ------------------------------------------------------------------ */
/*  File diff component                                                 */
/* ------------------------------------------------------------------ */

function FileDiffComponent({ diff }: { diff: FileDiff }) {
  const Icon = diff.isNew ? FilePlus : diff.isDeleted ? FileX : FilePen;
  const color = diff.isNew ? "text-green-400" : diff.isDeleted ? "text-red-400" : "text-yellow-400";
  const text = diff.isNew ? "Nouveau" : diff.isDeleted ? "Supprimé" : "Modifié";

  return (
    <div className="flex items-center gap-1 text-[10px] text-zinc-400">
      <Icon className={`w-3 h-3 ${color}`} />
      <span className={color}>{text}</span>
      <span className="text-zinc-500">{diff.path}</span>
      {diff.added > 0 && <span className="text-green-400">+{diff.added}</span>}
      {diff.removed > 0 && <span className="text-red-400">-{diff.removed}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat panel                                                          */
/* ------------------------------------------------------------------ */

export function ChatPanel({ currentPath, repo, onApplyCode, onAgentCommit }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [atSuggestions, setAtSuggestions] = useState<string[]>([]);
  const [atDropdownIdx, setAtDropdownIdx] = useState(0);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { resetChat } = useResetChat();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() && !imageDataUrl) return;

    const userMessage: Message = { role: "user", content: input, imageDataUrl: imageDataUrl || undefined };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setImageDataUrl(null);
    setIsPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo,
          message: input,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          contextFile: currentPath,
          imageDataUrl: imageDataUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Failed to get reader from response body");

      let receivedContent = "";
      let agentMessage: Message = { role: "agent", content: "" };
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += new TextDecoder().decode(value, { stream: true });

        try {
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.trim() === "") continue;
            const data = JSON.parse(line);

            if (data.type === "chunk") {
              receivedContent += data.content;
              agentMessage = { ...agentMessage, content: receivedContent };
              setMessages((prev) => {
                const lastMessage = prev[prev.length - 1];
                if (lastMessage && lastMessage.role === "agent") {
                  return [...prev.slice(0, -1), agentMessage];
                }
                return [...prev, agentMessage];
              });
            } else if (data.type === "metadata") {
              agentMessage = {
                ...agentMessage,
                contextFile: data.contextFile,
                filesChanged: data.filesChanged,
                diffs: data.diffs,
                commitSha: data.commitSha,
                model: data.model,
                suggestions: data.suggestions,
              };
              setMessages((prev) => {
                const lastMessage = prev[prev.length - 1];
                if (lastMessage && lastMessage.role === "agent") {
                  return [...prev.slice(0, -1), agentMessage];
                }
                return [...prev, agentMessage];
              });
            }
          }
        } catch (e) {
          console.error("Error parsing JSON chunk:", e, "Buffer:", buffer);
          // If JSON parsing fails, it might be an incomplete chunk, so keep it in buffer
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: "Désolé, une erreur est survenue lors de l'envoi de votre message." },
      ]);
    } finally {
      setIsPending(false);
    }
  }, [input, messages, currentPath, repo, imageDataUrl]);

  const handleStop = useCallback(() => {
    // TODO: Implement actual stop functionality if API supports it
    setIsPending(false);
    console.log("Chat stopped by user.");
  }, []);

  const handleResetChat = useCallback(() => {
    setMessages([]);
    setInput("");
    setImageDataUrl(null);
    setIsPending(false);
    resetChat(); // Call the API client reset
  }, [resetChat]);

  const handleImageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      setImageDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveImage = useCallback(() => {
    setImageDataUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleAtChange = useCallback(async (query: string) => {
    if (query.length > 0) {
      try {
        const response = await fetch(`/api/github/files?repo=${repo}&query=${query}`);
        const files = await response.json();
        setAtSuggestions(files.map((f: { path: string }) => f.path));
        setAtDropdownIdx(0);
      } catch (error) {
        console.error("Error fetching files:", error);
        setAtSuggestions([]);
      }
    } else {
      setAtSuggestions([]);
    }
  }, [repo]);

  const insertAtMention = useCallback((filePath: string) => {
    setInput(prev => {
      const parts = prev.split("@");
      parts[parts.length - 1] = filePath + " ";
      return parts.join("@");
    });
    setAtQuery(null);
    setAtSuggestions([]);
  }, []);

  return (
    <div
      className="flex flex-col h-full bg-[#0d1117] text-[#c9d1d9] border-l border-[#21262d]"
      style={{ width: 380, flexShrink: 0 }}
    >
      <div
        className="flex items-center justify-between p-3 border-b border-[#21262d]"
        style={{ minHeight: 48 }}
      >
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium" style={{ fontFamily: SANS }}>
            Agent
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Nouveau bouton pour l'historique du chat */}
          <button
            onClick={() => console.log("Afficher l'historique du chat")}
            title="Historique du chat"
            style={{
              width: 24, height: 24, borderRadius: 6,
              background: "#21262d", color: "#c9d1d9", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s",
            }}
          >
            <History style={{ width: 12, height: 12 }} />
          </button>
          <button
            onClick={handleResetChat}
            title="Réinitialiser le chat"
            style={{
              width: 24, height: 24, borderRadius: 6,
              background: "#21262d", color: "#c9d1d9", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s",
            }}
          >
            <RotateCcw style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-sm">
            <Bot className="w-8 h-8 mb-2" />
            <span>Comment puis-je vous aider ?</span>
          </div>
        )}
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] p-2 rounded-lg ${
                msg.role === "user"
                  ? "bg-[#005cc5] text-white"
                  : "bg-[#161b22] text-[#c9d1d9] border border-[#21262d]"
              }`}
              style={{ fontFamily: SANS }}
            >
              {msg.imageDataUrl && (
                <img src={msg.imageDataUrl} alt="User provided" className="max-w-full h-auto rounded-md mb-2" />
              )}
              {msg.content.split("```").map((part, i) => {
                if (i % 2 === 1) {
                  const [lang, ...codeParts] = part.split("\n");
                  const code = codeParts.join("\n");
                  return <CodeBlock key={i} lang={lang.trim()} code={code.trim()} />;
                }
                return <p key={i} className="whitespace-pre-wrap text-sm">{part}</p>;
              })}
              {msg.role === "agent" && msg.contextFile && (
                <div className="mt-2 text-[10px] text-zinc-500 flex items-center gap-1">
                  <FileCode className="w-3 h-3" />
                  Contexte: {msg.contextFile}
                </div>
              )}
              {msg.role === "agent" && msg.filesChanged && msg.filesChanged.length > 0 && (
                <div className="mt-2 text-[10px] text-zinc-500 flex items-center gap-1">
                  <GitCommit className="w-3 h-3" />
                  Fichiers modifiés: {msg.filesChanged.join(", ")}
                </div>
              )}
              {msg.role === "agent" && msg.diffs && msg.diffs.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.diffs.map((diff, diffIdx) => (
                    <FileDiffComponent key={diffIdx} diff={diff} />
                  ))}
                </div>
              )}
              {msg.role === "agent" && msg.commitSha && (
                <div className="mt-2 text-[10px] text-zinc-500 flex items-center gap-1">
                  <GitCommit className="w-3 h-3" />
                  Commit:{" "}
                  <a
                    href={`https://github.com/${repo}/commit/${msg.commitSha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline flex items-center gap-0.5"
                  >
                    {msg.commitSha.substring(0, 7)} <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
              {msg.role === "agent" && msg.model && (
                <div className="mt-2 text-[10px] text-zinc-500 flex items-center gap-1">
                  <Cpu className="w-3 h-3" />
                  Modèle: {msg.model}
                </div>
              )}
              {msg.role === "agent" && msg.suggestions && msg.suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {msg.suggestions.map((suggestion, sIdx) => (
                    <button
                      key={sIdx}
                      onClick={() => setInput(suggestion)}
                      className="text-[10px] px-2 py-1 rounded-full bg-[#21262d] text-zinc-400 hover:bg-[#30363d] transition-colors"
                      style={{ fontFamily: SANS }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {isPending && (
          <div className="flex justify-start">
            <div
              className="max-w-[80%] p-2 rounded-lg bg-[#161b22] text-[#c9d1d9] border border-[#21262d] flex items-center gap-2"
              style={{ fontFamily: SANS }}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>L'agent réfléchit...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-[#21262d]">
        {imageDataUrl && (
          <div className="relative mb-2">
            <img src={imageDataUrl} alt="Preview" className="max-h-24 rounded-md" />
            <button
              onClick={handleRemoveImage}
              className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="relative mb-2">
          {atQuery !== null && atSuggestions.length > 0 && (
            <div
              className="absolute bottom-full left-0 w-full bg-[#161b22] border border-[#21262d] rounded-md shadow-lg z-10 max-h-48 overflow-y-auto"
              style={{ marginBottom: 5 }}
            >
              {atSuggestions.map((suggestion, idx) => (
                <div
                  key={suggestion}
                  className={`p-2 text-xs cursor-pointer ${
                    idx === atDropdownIdx ? "bg-[#21262d]" : "hover:bg-[#1f242c]"
                  }`}
                  onClick={() => insertAtMention(suggestion)}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <Textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const lastAt = e.target.value.lastIndexOf("@");
                if (lastAt !== -1 && (e.target.value.length === lastAt + 1 || /\s@/.test(e.target.value.substring(0, lastAt + 1)))) {
                  const query = e.target.value.substring(lastAt + 1);
                  setAtQuery(query);
                  handleAtChange(query);
                } else {
                  setAtQuery(null);
                  setAtSuggestions([]);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && atQuery === null) { e.preventDefault(); handleSend(); }
                if (e.key === "Enter" && atQuery !== null && atSuggestions.length > 0 && !e.shiftKey) { e.preventDefault(); insertAtMention(atSuggestions[atDropdownIdx] ?? ""); }
                if (e.key === "Enter" && atQuery === null && !e.shiftKey) { e.preventDefault(); handleSend(); }
                if (e.key === "Escape") setAtQuery(null);
                if (atSuggestions.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setAtDropdownIdx(i => Math.min(i + 1, atSuggestions.length - 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setAtDropdownIdx(i => Math.max(i - 1, 0)); }
                  if (e.key === "Tab") { e.preventDefault(); insertAtMention(atSuggestions[atDropdownIdx] ?? ""); }
                }
              }}
              placeholder={repo ? "Message (↵ envoyer, ⇧↵ saut de ligne, @ fichier)" : "Connectez d'abord un dépôt…"}
              disabled={isPending}
              rows={1}
              className="resize-none text-xs leading-relaxed pr-8"
              style={{
                fontFamily: SANS, fontSize: 12.5,
                background: "#0d1117", border: "1px solid #21262d",
                borderRadius: 8, color: "#c9d1d9",
                minHeight: 36, maxHeight: 120,
                padding: "8px 32px 8px 10px",
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Joindre une image"
              style={{
                position: "absolute", right: 6, bottom: 7,
                color: "#6e7681", background: "none", border: "none", cursor: "pointer",
              }}
            >
              <Paperclip style={{ width: 13, height: 13 }} />
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ""; }} />

          {isPending ? (
            <button
              onClick={handleStop}
              title="Arrêter"
              style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: "#f85149", color: "white", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Square style={{ width: 12, height: 12 }} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() && !imageDataUrl}
              style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: (!input.trim() && !imageDataUrl) ? "#21262d" : "#238636",
                color: (!input.trim() && !imageDataUrl) ? "#6e7681" : "white",
                border: "none", cursor: (!input.trim() && !imageDataUrl) ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.15s",
              }}
            >
              <Send style={{ width: 13, height: 13 }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```
