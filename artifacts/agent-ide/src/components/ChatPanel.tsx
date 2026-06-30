import React, { useState, useRef, useEffect, useCallback } from "react";
import { useResetChat } from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Send, RotateCcw, Bot, FileCode, Check, Zap, Copy,
  GitCommit, FilePlus, FilePen, FileX, ExternalLink, Paperclip, X, Square,
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

type ModelChoice = "auto" | "claude" | "groq" | "gemini";

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
/*  Code block — MONO font                                              */
/* ------------------------------------------------------------------ */

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-white/10">
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b border-white/10"
        style={{ background: "#161b22" }}
      >
        <span
          className="uppercase tracking-wider"
          style={{ fontFamily: MONO, fontSize: 10, color: "#6e7681" }}
        >
          {lang || "code"}
        </span>
        <CopyButton text={code} />
      </div>
      <pre
        style={{
          fontFamily: MONO,
          fontSize: 12,
          lineHeight: 1.6,
          color: "#c9d1d9",
          background: "#0d1117",
          padding: "10px 14px",
          margin: 0,
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Content renderer — markdown-lite                                    */
/* ------------------------------------------------------------------ */

function parseContent(content: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const before = content.slice(last, match.index);
    if (before) {
      parts.push(
        <span
          key={`t-${match.index}`}
          className="whitespace-pre-wrap"
          style={{ fontFamily: SANS, fontSize: 13, lineHeight: "1.65" }}
        >
          {before}
        </span>
      );
    }
    parts.push(<CodeBlock key={`c-${match.index}`} lang={match[1] ?? ""} code={match[2] ?? ""} />);
    last = match.index + match[0].length;
  }

  const tail = content.slice(last);
  if (tail) {
    parts.push(
      <span
        key="tail"
        className="whitespace-pre-wrap"
        style={{ fontFamily: SANS, fontSize: 13, lineHeight: "1.65" }}
      >
        {tail}
      </span>
    );
  }
  return parts;
}

/* ------------------------------------------------------------------ */
/*  File change badge with diff stats                                   */
/* ------------------------------------------------------------------ */

function FileChangeBadge({ path, diff }: { path: string; diff?: FileDiff }) {
  const Icon = diff?.isDeleted ? FileX : diff?.isNew ? FilePlus : FilePen;
  const color = diff?.isDeleted ? "#f85149" : diff?.isNew ? "#3fb950" : "#61afef";

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <Icon className="w-3 h-3 shrink-0" style={{ color }} />
      <span className="truncate flex-1" style={{ fontFamily: MONO, fontSize: 11, color: "#c9d1d9" }}>{path}</span>
      {diff && (diff.added > 0 || diff.removed > 0) && (
        <span style={{ fontFamily: MONO, fontSize: 10, display: "flex", gap: 4, flexShrink: 0 }}>
          {diff.added > 0 && <span style={{ color: "#3fb950" }}>+{diff.added}</span>}
          {diff.removed > 0 && <span style={{ color: "#f85149" }}>-{diff.removed}</span>}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Suggestion chips                                                    */
/* ------------------------------------------------------------------ */

function SuggestionChips({ suggestions, onPick }: { suggestions: string[]; onPick: (s: string) => void }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontFamily: SANS, fontSize: 10, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
        Suggestions
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            style={{
              fontFamily: SANS, fontSize: 11.5,
              color: "#c9d1d9", background: "#161b22",
              border: "1px solid #30363d", borderRadius: 20,
              padding: "4px 10px", cursor: "pointer",
              transition: "border-color 0.15s, background 0.15s",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#61afef";
              e.currentTarget.style.background = "rgba(97,175,239,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#30363d";
              e.currentTarget.style.background = "#161b22";
            }}
          >
            → {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent result card                                                   */
/* ------------------------------------------------------------------ */

function AgentResultCard({ msg, onSuggestion }: { msg: Message; onSuggestion: (s: string) => void }) {
  const hasChanges = (msg.filesChanged?.length ?? 0) > 0;
  const repoUrl = "https://github.com/geantilchristian-dotcom/mon-agent-propre";

  return (
    <div className="group w-full max-w-[95%]">
      <div className="rounded-lg rounded-tl-sm overflow-hidden" style={{ background: "#161b22", border: "1px solid #21262d" }}>
        <div className="px-3 pt-3 pb-2" style={{ color: "#c9d1d9", fontFamily: SANS }}>
          {parseContent(msg.content)}
        </div>

        {/* Changed files panel */}
        {hasChanges && (
          <div style={{ borderTop: "1px solid #21262d", background: "#0d1117", padding: "8px 12px" }}>
            <div className="flex items-center gap-2 mb-2">
              <GitCommit className="w-3.5 h-3.5" style={{ color: "#3fb950" }} />
              <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, color: "#3fb950", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {msg.filesChanged!.length} fichier{msg.filesChanged!.length > 1 ? "s" : ""} modifié{msg.filesChanged!.length > 1 ? "s" : ""}
              </span>
              {msg.commitSha && (
                <a
                  href={`${repoUrl}/commit/${msg.commitSha}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 hover:text-blue-300 transition-colors"
                  style={{ fontFamily: SANS, fontSize: 10.5, color: "#61afef" }}
                >
                  <ExternalLink className="w-3 h-3" />
                  Voir sur GitHub
                </a>
              )}
            </div>

            <div className="space-y-0.5">
              {msg.filesChanged!.map((f) => {
                const diff = msg.diffs?.find((d) => d.path === f);
                return <FileChangeBadge key={f} path={f} diff={diff} />;
              })}
            </div>

            {msg.commitSha && (
              <div className="mt-2" style={{ fontFamily: MONO, fontSize: 10.5, color: "#6e7681" }}>
                commit <span style={{ color: "#8b949e" }}>{msg.commitSha.slice(0, 7)}</span>
                <span style={{ fontFamily: SANS, marginLeft: 4 }}>— Render redéployera automatiquement</span>
              </div>
            )}
          </div>
        )}

        {/* Suggestions */}
        {(msg.suggestions?.length ?? 0) > 0 && (
          <div style={{ borderTop: "1px solid #21262d", padding: "8px 12px" }}>
            <SuggestionChips suggestions={msg.suggestions!} onPick={onSuggestion} />
          </div>
        )}
      </div>

      {/* Model + copy */}
      <div className="flex items-center justify-between mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="flex items-center gap-1 pl-1" style={{ fontFamily: MONO, fontSize: 10, color: "#6e7681" }}>
          <Zap className="w-2.5 h-2.5" />
          {msg.model ?? "Agent IA"}
        </span>
        <CopyButton text={msg.content} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status types                                                        */
/* ------------------------------------------------------------------ */

type AgentStatus = "idle" | "thinking" | "reading" | "writing" | "done" | "error";

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle:     "Prêt — posez une question ou demandez une modification",
  thinking: "L'agent analyse votre projet…",
  reading:  "Lecture des fichiers en cours…",
  writing:  "Application des changements sur GitHub…",
  done:     "Modifications appliquées ✓",
  error:    "Erreur de l'agent",
};

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle:     "#6e7681",
  thinking: "#e5c07b",
  reading:  "#61afef",
  writing:  "#d19a66",
  done:     "#3fb950",
  error:    "#f85149",
};

/* ------------------------------------------------------------------ */
/*  Model selector labels                                               */
/* ------------------------------------------------------------------ */

const MODEL_LABELS: Record<ModelChoice, string> = {
  auto:   "Auto",
  claude: "Claude",
  groq:   "Groq",
  gemini: "Gemini",
};

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

function chatStorageKey(repo: string) {
  return `agent-ide-chat-${repo.replace(/[^a-zA-Z0-9-]/g, "_")}`;
}

export function ChatPanel({ currentPath, repo, onApplyCode: _onApplyCode, onAgentCommit }: ChatPanelProps & { onApplyCode?: (code: string) => void }) {
  const storageKey = chatStorageKey(repo);

  const [messages, setMessages] = useState<Message[]>(() => {
    if (!repo) return [];
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Message[]; }
    catch { return []; }
  });
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [streamMsg, setStreamMsg] = useState<string>("");
  const [isPending, setIsPending] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelChoice>("auto");

  /* @ mention autocomplete */
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [atDropdownIdx, setAtDropdownIdx] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resetMutation = useResetChat();

  /* Fetch file tree once when connected */
  useEffect(() => {
    if (!repo) { setFileTree([]); return; }
    fetch("/api/github/files?path=")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const files: string[] = [];
          const flatten = (items: unknown[], prefix = "") => {
            for (const item of items) {
              const entry = item as { type: string; path: string; name: string };
              if (entry.type === "file") files.push(prefix ? `${prefix}/${entry.name}` : entry.name);
            }
          };
          flatten(data);
          setFileTree(files.map((f: unknown) => {
            const entry = f as { path?: string } | string;
            return typeof entry === "string" ? entry : (entry as { path: string }).path;
          }));
        }
      })
      .catch(() => {/* ignore */});
  }, [repo]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status]);

  useEffect(() => {
    if (!repo) return;
    try { localStorage.setItem(storageKey, JSON.stringify(messages)); } catch { /* ignore */ }
  }, [messages, repo, storageKey]);

  useEffect(() => {
    if (!repo) { setMessages([]); return; }
    try {
      const saved = JSON.parse(localStorage.getItem(chatStorageKey(repo)) ?? "[]") as Message[];
      setMessages(saved);
    } catch { setMessages([]); }
  }, [repo]);

  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => setImageDataUrl(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) { const f = item.getAsFile(); if (f) handleImageFile(f); }
  }, [handleImageFile]);

  /* @ mention detection */
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    const cursor = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursor);
    const atMatch = textBefore.match(/@([\w./\-]*)$/);
    if (atMatch) {
      setAtQuery(atMatch[1] ?? "");
      setAtDropdownIdx(0);
    } else {
      setAtQuery(null);
    }
  }, []);

  const atSuggestions = atQuery !== null
    ? fileTree.filter((f) => f.toLowerCase().includes(atQuery.toLowerCase())).slice(0, 8)
    : [];

  const insertAtMention = useCallback((file: string) => {
    const val = input;
    const cursor = inputRef.current?.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursor);
    const replaced = textBefore.replace(/@([\w./\-]*)$/, `@${file} `);
    const newVal = replaced + val.slice(cursor);
    setInput(newVal);
    setAtQuery(null);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.selectionStart = replaced.length;
        inputRef.current.selectionEnd = replaced.length;
        inputRef.current.focus();
      }
    }, 0);
  }, [input]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && !imageDataUrl) || isPending) return;

    let imageBase64: string | null = null;
    let imageMime: string | null = null;
    if (imageDataUrl) {
      const [header, data] = imageDataUrl.split(",");
      imageBase64 = data ?? null;
      imageMime = header?.match(/:(.*?);/)?.[1] ?? "image/png";
    }

    const userMsg: Message = {
      role: "user",
      content: text || "📷 Image partagée",
      contextFile: currentPath ?? undefined,
      imageDataUrl: imageDataUrl ?? undefined,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setAtQuery(null);
    setImageDataUrl(null);
    setIsPending(true);
    setStatus("thinking");
    setStreamMsg("📁 Connexion à l'agent...");

    const history = nextMessages.map(m => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.imageDataUrl ? `[Image jointe] ${m.content}` : m.content,
    })).slice(-16);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text || "Analyse cette image et dis-moi ce que tu vois / comment corriger le problème.",
          currentFile: currentPath ?? null,
          imageBase64,
          imageMime,
          model: selectedModel === "auto" ? null : selectedModel,
          history,
        }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: "Erreur de connexion" })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as {
              type: string;
              message?: string;
              response?: string;
              filesChanged?: string[];
              diffs?: FileDiff[];
              commitSha?: string;
              model?: string;
              suggestions?: string[];
            };
            if (ev.type === "status" || ev.type === "turn" || ev.type === "reading" || ev.type === "committing") {
              setStreamMsg(ev.message ?? "");
              if (ev.type === "reading") setStatus("reading");
              else if (ev.type === "committing") setStatus("writing");
              else setStatus("thinking");
            } else if (ev.type === "done") {
              const hasChanges = (ev.filesChanged?.length ?? 0) > 0;
              setStatus(hasChanges ? "done" : "idle");
              setTimeout(() => setStatus("idle"), hasChanges ? 4000 : 0);
              setMessages(prev => [...prev, {
                role: "agent",
                content: ev.response ?? "",
                filesChanged: ev.filesChanged ?? [],
                diffs: ev.diffs ?? [],
                commitSha: ev.commitSha ?? undefined,
                model: ev.model ?? undefined,
                suggestions: ev.suggestions ?? [],
              }]);
              setStreamMsg("");
              setIsPending(false);
              if (hasChanges && onAgentCommit) onAgentCommit();
              return;
            } else if (ev.type === "error") {
              throw new Error(ev.message ?? "Erreur agent");
            }
          } catch { /* skip malformed event */ }
        }
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Erreur de l'agent";
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
      setMessages(prev => [...prev, { role: "agent", content: `❌ ${msg}`, filesChanged: [] }]);
    } finally {
      setIsPending(false);
      setStreamMsg("");
      abortRef.current = null;
    }
  }, [input, imageDataUrl, isPending, currentPath, messages, selectedModel, onAgentCommit]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsPending(false);
    setStreamMsg("");
    setStatus("idle");
  }, []);

  const handleReset = () => {
    resetMutation.mutate(undefined, {
      onSuccess: () => {
        setMessages([]);
        setStatus("idle");
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      }
    });
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "#010409", fontFamily: SANS }}>

      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{ height: 36, borderBottom: "1px solid #21262d" }}
      >
        <div className="flex items-center gap-2">
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3fb950", boxShadow: "0 0 5px #3fb950" }} />
          <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: "#c9d1d9", letterSpacing: "0.01em" }}>
            Agent IA
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Model selector */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value as ModelChoice)}
            disabled={isPending}
            title="Choisir le modèle IA"
            style={{
              fontFamily: MONO,
              fontSize: 10,
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 4,
              color: "#8b949e",
              padding: "2px 4px",
              cursor: isPending ? "default" : "pointer",
              outline: "none",
            }}
          >
            {(Object.keys(MODEL_LABELS) as ModelChoice[]).map((m) => (
              <option key={m} value={m}>{MODEL_LABELS[m]}</option>
            ))}
          </select>

          {/* Reset button */}
          <button
            onClick={handleReset}
            disabled={resetMutation.isPending || isPending}
            title="Réinitialiser la conversation"
            className="flex items-center justify-center rounded hover:bg-white/5 transition-colors"
            style={{ width: 22, height: 22, color: "#6e7681" }}
          >
            {resetMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "12px 10px" }} ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center" style={{ padding: "0 12px" }}>
            <Bot className="w-9 h-9 mb-3" style={{ color: "#6e7681", opacity: 0.4 }} />
            <p style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: "#8b949e", marginBottom: 4 }}>
              Agent de codage autonome
            </p>
            <p style={{ fontFamily: SANS, fontSize: 12, color: "#6e7681", lineHeight: 1.6, marginBottom: 16 }}>
              Décrivez ce que vous voulez faire. L'agent lit votre projet, applique les changements et les pousse sur GitHub.
            </p>
            <div style={{ width: "100%", background: "#161b22", border: "1px solid #21262d", borderRadius: 8, padding: "10px 12px" }}>
              <p style={{ fontFamily: SANS, fontSize: 10.5, fontWeight: 600, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                Exemples
              </p>
              {[
                "Ajoute une page de connexion",
                "Crée un composant Modal réutilisable",
                "Corrige l'erreur dans Sidebar.tsx",
                "Ajoute un bouton dark mode dans le header",
              ].map((ex) => (
                <button
                  key={ex}
                  onClick={() => { setInput(ex); inputRef.current?.focus(); }}
                  className="block w-full text-left hover:text-foreground transition-colors"
                  style={{ fontFamily: SANS, fontSize: 12, color: "#8b949e", padding: "3px 0", cursor: "pointer" }}
                >
                  → {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                {msg.role === "user" ? (
                  <div style={{ maxWidth: "88%" }}>
                    {msg.imageDataUrl && (
                      <div className="flex justify-end mb-1">
                        <img
                          src={msg.imageDataUrl}
                          alt="screenshot partagé"
                          style={{
                            maxWidth: 220, maxHeight: 160, borderRadius: 8,
                            border: "1px solid #30363d", objectFit: "cover",
                          }}
                        />
                      </div>
                    )}
                    <div
                      style={{
                        fontFamily: SANS,
                        fontSize: 13,
                        lineHeight: 1.6,
                        fontWeight: 400,
                        background: "#1f6feb",
                        color: "#ffffff",
                        borderRadius: "12px 12px 2px 12px",
                        padding: "8px 12px",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {msg.content}
                    </div>
                    {msg.contextFile && (
                      <div
                        className="flex items-center justify-end mt-0.5 gap-1"
                        style={{ fontFamily: MONO, fontSize: 10, color: "#6e7681" }}
                      >
                        <FileCode className="w-3 h-3" />
                        {msg.contextFile}
                      </div>
                    )}
                  </div>
                ) : (
                  <AgentResultCard
                    msg={msg}
                    onSuggestion={(s) => { setInput(s); inputRef.current?.focus(); }}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Thinking indicator */}
        {isPending && (
          <div className="flex items-start mt-4">
            <div
              style={{
                background: "#161b22",
                border: "1px solid #21262d",
                borderRadius: "2px 12px 12px 12px",
                padding: "10px 14px",
                maxWidth: "90%",
              }}
            >
              <div className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: STATUS_COLORS[status] }} />
                <span style={{ fontFamily: SANS, fontSize: 12, color: streamMsg ? "#c9d1d9" : STATUS_COLORS[status] }}>
                  {streamMsg || STATUS_LABELS[status]}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      <div style={{ padding: "10px 10px 8px", borderTop: "1px solid #21262d" }}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ""; }}
        />

        {currentPath && (
          <div
            className="flex items-center gap-1.5 mb-2 w-fit"
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              color: "#61afef",
              background: "rgba(97,175,239,0.08)",
              border: "1px solid rgba(97,175,239,0.2)",
              borderRadius: 4,
              padding: "2px 8px",
            }}
          >
            <FileCode className="w-3 h-3" />
            {currentPath.split("/").pop()}
          </div>
        )}

        {/* Image preview strip */}
        {imageDataUrl && (
          <div className="flex items-center gap-2 mb-2">
            <div style={{ position: "relative", display: "inline-flex" }}>
              <img
                src={imageDataUrl}
                alt="prévisualisation"
                style={{
                  height: 52, maxWidth: 80, borderRadius: 6,
                  border: "1px solid #30363d", objectFit: "cover",
                }}
              />
              <button
                onClick={() => setImageDataUrl(null)}
                style={{
                  position: "absolute", top: -6, right: -6,
                  width: 16, height: 16, borderRadius: "50%",
                  background: "#21262d", border: "1px solid #30363d",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "#8b949e",
                }}
              >
                <X style={{ width: 9, height: 9 }} />
              </button>
            </div>
            <span style={{ fontFamily: SANS, fontSize: 11, color: "#6e7681" }}>
              Image prête à envoyer
            </span>
          </div>
        )}

        {/* @ mention dropdown */}
        {atQuery !== null && atSuggestions.length > 0 && (
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 6,
              marginBottom: 4,
              overflow: "hidden",
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            {atSuggestions.map((f, idx) => (
              <button
                key={f}
                onMouseDown={(e) => { e.preventDefault(); insertAtMention(f); }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "5px 10px",
                  fontFamily: MONO,
                  fontSize: 11,
                  color: idx === atDropdownIdx ? "#c9d1d9" : "#8b949e",
                  background: idx === atDropdownIdx ? "rgba(97,175,239,0.1)" : "transparent",
                  cursor: "pointer",
                  border: "none",
                }}
                onMouseEnter={() => setAtDropdownIdx(idx)}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        <div style={{ position: "relative" }}>
          <Textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={e => {
              if (atQuery !== null && atSuggestions.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setAtDropdownIdx(i => Math.min(i + 1, atSuggestions.length - 1)); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setAtDropdownIdx(i => Math.max(i - 1, 0)); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertAtMention(atSuggestions[atDropdownIdx] ?? ""); return; }
                if (e.key === "Escape") { setAtQuery(null); return; }
              }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            onPaste={handlePaste}
            placeholder={imageDataUrl ? "Décrivez le problème ou envoyez directement…" : "Décrivez ce que vous voulez faire… (@ pour mentionner un fichier)"}
            disabled={isPending}
            data-testid="input-chat-message"
            style={{
              fontFamily: SANS,
              fontSize: 13,
              lineHeight: 1.6,
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              color: "#c9d1d9",
              resize: "none",
              minHeight: 42,
              maxHeight: 160,
              padding: "9px 64px 9px 12px",
              width: "100%",
              outline: "none",
            }}
            className="focus-visible:ring-0 focus-visible:outline-none"
          />

          {/* Paperclip button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending}
            title="Joindre une image (ou Ctrl+V pour coller)"
            style={{
              position: "absolute", right: 38, bottom: 8,
              width: 26, height: 26, borderRadius: 6,
              background: imageDataUrl ? "rgba(97,175,239,0.15)" : "transparent",
              color: imageDataUrl ? "#61afef" : "#6e7681",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s",
              cursor: isPending ? "default" : "pointer",
            }}
          >
            <Paperclip style={{ width: 13, height: 13 }} />
          </button>

          {/* Send / Stop button */}
          {isPending ? (
            <button
              onClick={handleStop}
              title="Arrêter l'agent"
              style={{
                position: "absolute", right: 8, bottom: 8,
                width: 26, height: 26, borderRadius: 6,
                background: "#b91c1c",
                color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.15s",
                cursor: "pointer",
              }}
            >
              <Square style={{ width: 11, height: 11 }} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={(!input.trim() && !imageDataUrl) || isPending}
              data-testid="button-send-chat"
              style={{
                position: "absolute", right: 8, bottom: 8,
                width: 26, height: 26, borderRadius: 6,
                background: (input.trim() || imageDataUrl) && !isPending ? "#238636" : "#21262d",
                color: (input.trim() || imageDataUrl) && !isPending ? "#fff" : "#6e7681",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.15s",
                cursor: (input.trim() || imageDataUrl) && !isPending ? "pointer" : "default",
              }}
            >
              <Send style={{ width: 13, height: 13 }} />
            </button>
          )}
        </div>

        <p
          className="text-center mt-1.5"
          style={{ fontFamily: SANS, fontSize: 10, color: "#6e7681" }}
        >
          L'agent lit, modifie et commit directement sur GitHub
        </p>
      </div>

      {/* ── Status bar ── */}
      <div
        className="flex items-center gap-2 shrink-0"
        style={{ height: 24, padding: "0 10px", borderTop: "1px solid #21262d", background: "#0a0e14" }}
      >
        <span
          style={{
            width: 6, height: 6, borderRadius: "50%",
            background: STATUS_COLORS[status],
            flexShrink: 0,
            boxShadow: isPending ? `0 0 6px ${STATUS_COLORS[status]}` : "none",
            transition: "background 0.3s, box-shadow 0.3s",
          }}
        />
        <span style={{ fontFamily: SANS, fontSize: 10.5, color: "#6e7681", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isPending && streamMsg ? streamMsg : STATUS_LABELS[status]}
        </span>
      </div>
    </div>
  );
}
