import React, { useState, useRef, useEffect } from "react";
import { useRunAgent, useResetChat, useReadGithubFile, getReadGithubFileQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Send, RotateCcw, Bot, FileCode, Check, Zap, Copy,
  GitCommit, FilePlus, FilePen, FileX, ExternalLink,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Font constants                                                      */
/* ------------------------------------------------------------------ */

/** UI prose — headers, labels, bubbles, input */
const SANS = "'Inter', 'Segoe UI', system-ui, sans-serif";
/** Code, file paths, commit SHAs, model labels */
const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";

/* ------------------------------------------------------------------ */
/*  Props / Types                                                       */
/* ------------------------------------------------------------------ */

interface ChatPanelProps {
  currentPath: string | null;
  onApplyCode?: (code: string) => void;
}

interface Message {
  role: "user" | "agent";
  content: string;
  contextFile?: string;
  filesChanged?: string[];
  commitSha?: string;
  model?: string;
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
      {/* Language label row */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b border-white/10"
        style={{ background: "#161b22" }}
      >
        <span
          className="uppercase tracking-wider"
          style={{ fontFamily: MONO, fontSize: 10, color: "#6e7681" }}
        >
          {lang || "text"}
        </span>
        <CopyButton text={code} />
      </div>
      {/* Code body — MONO */}
      <pre
        style={{
          fontFamily: MONO,
          fontSize: 12,
          lineHeight: "20px",
          background: "#0d1117",
          color: "#c9d1d9",
          padding: "12px 14px",
          margin: 0,
          overflowX: "auto",
          maxHeight: 340,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Parse prose + fenced code blocks                                    */
/* ------------------------------------------------------------------ */

function parseContent(content: string) {
  const parts: React.ReactNode[] = [];
  const regex = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
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
/*  File change badge — MONO for path                                   */
/* ------------------------------------------------------------------ */

function FileChangeBadge({ path }: { path: string }) {
  const Icon = FilePen;
  return (
    <div className="flex items-center gap-1.5 py-0.5" style={{ color: "#61afef" }}>
      <Icon className="w-3 h-3 shrink-0" />
      <span className="truncate" style={{ fontFamily: MONO, fontSize: 11 }}>{path}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent result card                                                   */
/* ------------------------------------------------------------------ */

function AgentResultCard({ msg }: { msg: Message }) {
  const hasChanges = (msg.filesChanged?.length ?? 0) > 0;
  const repoUrl = "https://github.com/geantilchristian-dotcom/mon-agent-propre";

  return (
    <div className="group w-full max-w-[95%]">
      <div className="rounded-lg rounded-tl-sm overflow-hidden" style={{ background: "#161b22", border: "1px solid #21262d" }}>
        {/* AI prose — SANS */}
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
              {msg.filesChanged!.map((f) => <FileChangeBadge key={f} path={f} />)}
            </div>

            {msg.commitSha && (
              <div className="mt-2" style={{ fontFamily: MONO, fontSize: 10.5, color: "#6e7681" }}>
                commit <span style={{ color: "#8b949e" }}>{msg.commitSha.slice(0, 7)}</span>
                <span style={{ fontFamily: SANS, marginLeft: 4 }}>— Render redéployera automatiquement</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model + copy — MONO for model name */}
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
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function ChatPanel({ currentPath }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<AgentStatus>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const agentMutation = useRunAgent();
  const resetMutation = useResetChat();

  const { data: _fileData } = useReadGithubFile(
    { path: currentPath || "" },
    { query: { enabled: !!currentPath, queryKey: getReadGithubFileQueryKey({ path: currentPath || "" }) } }
  );

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || agentMutation.isPending) return;

    setMessages(prev => [...prev, { role: "user", content: text, contextFile: currentPath ?? undefined }]);
    setInput("");
    setStatus("thinking");

    agentMutation.mutate(
      { data: { message: text, currentFile: currentPath ?? null } },
      {
        onSuccess: (data) => {
          const d = data as { response: string; filesChanged: string[]; commitSha?: string | null; model?: string | null };
          const hasChanges = d.filesChanged.length > 0;
          setStatus(hasChanges ? "done" : "idle");
          setTimeout(() => setStatus("idle"), hasChanges ? 4000 : 0);
          setMessages(prev => [...prev, {
            role: "agent",
            content: d.response,
            filesChanged: d.filesChanged,
            commitSha: d.commitSha ?? undefined,
            model: d.model ?? undefined,
          }]);
        },
        onError: (err) => {
          setStatus("error");
          setTimeout(() => setStatus("idle"), 4000);
          const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Erreur de l'agent";
          setMessages(prev => [...prev, { role: "agent", content: `❌ ${message}`, filesChanged: [] }]);
        },
      }
    );
  };

  const handleReset = () => {
    resetMutation.mutate(undefined, {
      onSuccess: () => { setMessages([]); setStatus("idle"); }
    });
  };

  const isPending = agentMutation.isPending;

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

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "12px 10px" }} ref={scrollRef}>
        {messages.length === 0 ? (
          /* Empty state */
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
                  /* ── User bubble — SANS, conversational ── */
                  <div style={{ maxWidth: "88%" }}>
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
                  /* ── Agent card — prose in SANS, code in MONO ── */
                  <AgentResultCard msg={msg} />
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
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="w-3 h-3 animate-spin" style={{ color: STATUS_COLORS[status] }} />
                <span style={{ fontFamily: SANS, fontSize: 12, color: STATUS_COLORS[status] }}>
                  {STATUS_LABELS[status]}
                </span>
              </div>
              <span className="flex space-x-1">
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "#6e7681" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "#6e7681", animationDelay: "0.15s" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "#6e7681", animationDelay: "0.3s" }} />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      <div style={{ padding: "10px 10px 8px", borderTop: "1px solid #21262d" }}>
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

        <div style={{ position: "relative" }}>
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Décrivez ce que vous voulez faire…"
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
              padding: "9px 38px 9px 12px",
              width: "100%",
              outline: "none",
            }}
            className="focus-visible:ring-0 focus-visible:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isPending}
            data-testid="button-send-chat"
            style={{
              position: "absolute", right: 8, bottom: 8,
              width: 26, height: 26, borderRadius: 6,
              background: input.trim() && !isPending ? "#238636" : "#21262d",
              color: input.trim() && !isPending ? "#fff" : "#6e7681",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s",
              cursor: input.trim() && !isPending ? "pointer" : "default",
            }}
          >
            <Send style={{ width: 13, height: 13 }} />
          </button>
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
          {STATUS_LABELS[status]}
        </span>
      </div>
    </div>
  );
}
