import React, { useState, useRef, useEffect, useCallback } from "react";
import hljs from "highlight.js";
import { useResetChat } from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Send, RotateCcw, Bot, FileCode, Check, Zap, Copy,
  GitCommit, FilePlus, FilePen, FileX, ExternalLink, Paperclip, X, Square,
  Activity, CheckCircle2, Cpu, ShieldCheck, CloudUpload, Ban,
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
        const auto = hljs.highlightAuto(code);
        return auto.value;
      } catch {
        return null;
      }
    }
  }, [lang, code]);

  const html = highlighted();

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
          background: "#0d1117",
          padding: "10px 14px",
          margin: 0,
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {html ? (
          <code
            className={`hljs language-${lang}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <code style={{ color: "#c9d1d9" }}>{code}</code>
        )}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Lightweight Markdown renderer (no external deps)                   */
/* ------------------------------------------------------------------ */

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Patterns: **bold**, *italic*, `code`, [link](url)
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`t${idx++}`}>{text.slice(last, m.index)}</span>);
    if (m[2] !== undefined) {
      parts.push(<strong key={`b${idx++}`} style={{ fontWeight: 600, color: "#e6edf3" }}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      parts.push(<em key={`i${idx++}`} style={{ fontStyle: "italic" }}>{m[3]}</em>);
    } else if (m[4] !== undefined) {
      parts.push(
        <code key={`c${idx++}`} style={{ fontFamily: MONO, fontSize: 11.5, background: "rgba(110,118,129,0.2)", padding: "1px 5px", borderRadius: 4, color: "#e06c75" }}>
          {m[4]}
        </code>
      );
    } else if (m[5] !== undefined && m[6] !== undefined) {
      parts.push(
        <a key={`a${idx++}`} href={m[6]} target="_blank" rel="noopener noreferrer" style={{ color: "#58a6ff", textDecoration: "underline" }}>
          {m[5]}
        </a>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`t${idx++}`}>{text.slice(last)}</span>);
  return parts;
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let listItems: React.ReactNode[] = [];
  let listOrdered = false;

  const flushList = () => {
    if (listItems.length === 0) return;
    nodes.push(
      listOrdered
        ? <ol key={`ol-${i}`} style={{ margin: "4px 0", paddingLeft: 20, listStyleType: "decimal" }}>{listItems}</ol>
        : <ul key={`ul-${i}`} style={{ margin: "4px 0", paddingLeft: 20, listStyleType: "disc" }}>{listItems}</ul>
    );
    listItems = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      flushList();
      const lang = fenceMatch[1] ?? "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i++;
      }
      nodes.push(<CodeBlock key={`code-${i}`} lang={lang} code={codeLines.join("\n")} />);
      i++;
      continue;
    }

    // Headings
    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h3) { flushList(); nodes.push(<h3 key={`h3-${i}`} style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 4px", color: "#e6edf3" }}>{renderInline(h3[1]!)}</h3>); i++; continue; }
    if (h2) { flushList(); nodes.push(<h2 key={`h2-${i}`} style={{ fontSize: 14, fontWeight: 700, margin: "10px 0 4px", color: "#e6edf3" }}>{renderInline(h2[1]!)}</h2>); i++; continue; }
    if (h1) { flushList(); nodes.push(<h1 key={`h1-${i}`} style={{ fontSize: 16, fontWeight: 700, margin: "12px 0 6px", color: "#e6edf3" }}>{renderInline(h1[1]!)}</h1>); i++; continue; }

    // HR
    if (/^---+$/.test(line.trim())) {
      flushList();
      nodes.push(<hr key={`hr-${i}`} style={{ border: "none", borderTop: "1px solid #21262d", margin: "10px 0" }} />);
      i++;
      continue;
    }

    // Blockquote
    const bq = line.match(/^> (.+)/);
    if (bq) {
      flushList();
      nodes.push(
        <blockquote key={`bq-${i}`} style={{ margin: "6px 0", paddingLeft: 12, borderLeft: "3px solid #30363d", color: "#8b949e" }}>
          {renderInline(bq[1]!)}
        </blockquote>
      );
      i++;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[-*] (.+)/);
    if (ulMatch) {
      if (listItems.length > 0 && listOrdered) flushList();
      listOrdered = false;
      listItems.push(<li key={`li-${i}`} style={{ margin: "2px 0" }}>{renderInline(ulMatch[1]!)}</li>);
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\. (.+)/);
    if (olMatch) {
      if (listItems.length > 0 && !listOrdered) flushList();
      listOrdered = true;
      listItems.push(<li key={`li-${i}`} style={{ margin: "2px 0" }}>{renderInline(olMatch[1]!)}</li>);
      i++;
      continue;
    }

    flushList();

    // Empty line → spacing
    if (line.trim() === "") {
      nodes.push(<div key={`sp-${i}`} style={{ height: 6 }} />);
      i++;
      continue;
    }

    // Paragraph
    nodes.push(
      <p key={`p-${i}`} style={{ margin: "3px 0", lineHeight: 1.65 }}>
        {renderInline(line)}
      </p>
    );
    i++;
  }
  flushList();

  return (
    <div style={{ fontFamily: SANS, fontSize: 13, lineHeight: "1.65", color: "#c9d1d9" }}>
      {nodes}
    </div>
  );
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
/*  Live activity log                                                   */
/* ------------------------------------------------------------------ */

interface LogEntry {
  text: string;
  type: "status" | "turn" | "reading" | "committing";
}

const LOG_COLORS: Record<LogEntry["type"], string> = {
  status:     "#6e7681",
  turn:       "#e5c07b",
  reading:    "#61afef",
  committing: "#d19a66",
};

function LiveActivity({ log, status }: { log: LogEntry[]; status: AgentStatus }) {
  if (log.length === 0) return null;
  return (
    <div
      className="w-full max-w-[95%] rounded-lg rounded-tl-sm overflow-hidden"
      style={{ background: "#161b22", border: "1px solid #21262d" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid #21262d", background: "#0d1117" }}
      >
        <Activity className="w-3 h-3" style={{ color: "#3fb950" }} />
        <span style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, color: "#3fb950", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Agent en cours
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" style={{ color: LOG_COLORS[status === "reading" ? "reading" : status === "writing" ? "committing" : "turn"] }} />
        </div>
      </div>

      {/* Log entries */}
      <div className="px-3 py-2 space-y-1">
        {log.map((entry, i) => {
          const isLast = i === log.length - 1;
          const color = LOG_COLORS[entry.type];
          return (
            <div key={i} className="flex items-start gap-2">
              {isLast
                ? <Loader2 className="w-3 h-3 mt-0.5 animate-spin shrink-0" style={{ color }} />
                : <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "#3fb950" }} />
              }
              <span style={{ fontFamily: SANS, fontSize: 11.5, color: isLast ? color : "#8b949e", lineHeight: 1.5 }}>
                {entry.text}
              </span>
            </div>
          );
        })}
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

        {/* Model badge header */}
        {msg.model && (
          <div
            className="flex items-center gap-2 px-3 py-1.5"
            style={{ borderBottom: "1px solid #21262d", background: "#0d1117" }}
          >
            <Cpu className="w-3 h-3" style={{ color: "#61afef" }} />
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#61afef" }}>
              {msg.model}
            </span>
          </div>
        )}

        <div className="px-3 pt-3 pb-2">
          <MarkdownContent content={msg.content} />
        </div>

        {hasChanges && (
          <div style={{ borderTop: "1px solid #21262d", background: "#0d1117", padding: "8px 12px" }}>
            {/* Commit headline */}
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

            {/* File diff table */}
            <div className="space-y-0.5">
              {msg.filesChanged!.map((f) => {
                const diff = msg.diffs?.find((d) => d.path === f);
                return <FileChangeBadge key={f} path={f} diff={diff} />;
              })}
            </div>

            {/* Commit SHA + deploy note */}
            {msg.commitSha && (
              <div
                className="mt-2.5 flex items-center gap-2 rounded px-2 py-1.5"
                style={{ background: "#161b22", border: "1px solid #21262d" }}
              >
                <CheckCircle2 className="w-3 h-3 shrink-0" style={{ color: "#3fb950" }} />
                <div style={{ fontFamily: MONO, fontSize: 10.5 }}>
                  <span style={{ color: "#6e7681" }}>commit </span>
                  <span style={{ color: "#e6edf3", fontWeight: 600 }}>{msg.commitSha.slice(0, 7)}</span>
                  <span style={{ fontFamily: SANS, color: "#6e7681", marginLeft: 6 }}>
                    — Render redéploiera automatiquement ✓
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {(msg.suggestions?.length ?? 0) > 0 && (
          <div style={{ borderTop: "1px solid #21262d", padding: "8px 12px" }}>
            <SuggestionChips suggestions={msg.suggestions!} onPick={onSuggestion} />
          </div>
        )}
      </div>

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
/*  Pending commit confirmation card                                    */
/* ------------------------------------------------------------------ */

function PendingCommitCard({
  pending,
  onCommit,
  onCancel,
}: {
  pending: { filesChanged: string[]; diffs: FileDiff[]; committing: boolean };
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="w-full max-w-[95%] rounded-lg rounded-tl-sm overflow-hidden"
      style={{ background: "#161b22", border: "1px solid #e3b341" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid #e3b341", background: "#2d2100" }}
      >
        <ShieldCheck className="w-3.5 h-3.5" style={{ color: "#e3b341" }} />
        <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, color: "#e3b341", flex: 1 }}>
          {pending.filesChanged.length} fichier{pending.filesChanged.length > 1 ? "s" : ""} prêt{pending.filesChanged.length > 1 ? "s" : ""} — Voulez-vous pousser sur GitHub ?
        </span>
      </div>

      {/* File list */}
      <div className="px-3 py-2 space-y-0.5">
        {pending.filesChanged.map((f) => {
          const diff = pending.diffs.find((d) => d.path === f);
          return <FileChangeBadge key={f} path={f} diff={diff} />;
        })}
      </div>

      {/* Action buttons */}
      <div
        className="flex gap-2 px-3 py-2.5"
        style={{ borderTop: "1px solid #21262d" }}
      >
        <button
          onClick={onCommit}
          disabled={pending.committing}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "6px 0", borderRadius: 6, fontSize: 12, fontWeight: 600,
            fontFamily: SANS, cursor: pending.committing ? "wait" : "pointer",
            background: "#238636", color: "#ffffff", border: "none",
            opacity: pending.committing ? 0.7 : 1, transition: "opacity 0.15s",
          }}
        >
          {pending.committing
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Push en cours…</>
            : <><CloudUpload className="w-3.5 h-3.5" /> Oui, pousser sur GitHub</>
          }
        </button>
        <button
          onClick={onCancel}
          disabled={pending.committing}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
            fontFamily: SANS, cursor: "pointer",
            background: "transparent", color: "#8b949e",
            border: "1px solid #21262d",
          }}
        >
          <Ban className="w-3 h-3" /> Annuler
        </button>
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
  gpt:    "GPT",
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
  const [progressLog, setProgressLog] = useState<LogEntry[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelChoice>("auto");
  const [confirmPush, setConfirmPush] = useState<boolean>(() => {
    try { return localStorage.getItem("agent-ide-confirm-push") === "true"; } catch { return false; }
  });
  const [pendingCommit, setPendingCommit] = useState<{
    stagedId: string; filesChanged: string[]; diffs: FileDiff[]; committing: boolean;
  } | null>(null);

  const [fileTree, setFileTree] = useState<string[]>([]);
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [atDropdownIdx, setAtDropdownIdx] = useState(0);

  type ProviderStatus = { name: string; ok: boolean; latency: number; error?: string };
  const [llmHealth, setLlmHealth] = useState<ProviderStatus[] | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resetMutation = useResetChat();

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
      .catch(() => {});
  }, [repo]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status]);

  useEffect(() => {
    if (!repo) return;
    try {
      /* Strip imageDataUrl before saving — base64 images can exceed the 5 MB
         localStorage quota and cause silent save failures on every message. */
      const lean = messages.map((m) =>
        m.imageDataUrl ? { ...m, imageDataUrl: undefined } : m
      );
      localStorage.setItem(storageKey, JSON.stringify(lean));
    } catch { /* ignore */ }
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

    /* Read saved GitHub creds from localStorage for server-state recovery */
    let fallbackToken: string | null = null;
    let fallbackRepo: string | null = null;
    try {
      const saved = JSON.parse(localStorage.getItem("agent-ide-github-config") ?? "{}") as { token?: string; repo?: string };
      fallbackToken = saved.token ?? null;
      fallbackRepo = saved.repo ?? null;
    } catch { /* ignore */ }

    type SSEEvent = {
      type: string;
      message?: string;
      response?: string;
      filesChanged?: string[];
      diffs?: FileDiff[];
      commitSha?: string;
      stagedId?: string;
      model?: string;
      suggestions?: string[];
    };

    try {
      const agentSecret = (() => { try { return localStorage.getItem("agent-ide-agent-secret") ?? undefined; } catch { return undefined; } })();
      const resp = await fetch("/api/agent/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(agentSecret ? { "x-agent-secret": agentSecret } : {}),
        },
        body: JSON.stringify({
          message: text || "Analyse cette image et dis-moi ce que tu vois / comment corriger le problème.",
          currentFile: currentPath ?? null,
          imageBase64,
          imageMime,
          model: selectedModel === "auto" ? null : selectedModel,
          history,
          _githubToken: fallbackToken,
          _githubRepo: fallbackRepo,
          _agentSecret: agentSecret,
          autoCommit: !confirmPush,
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

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          let ev: SSEEvent;
          try {
            ev = JSON.parse(line.slice(6)) as SSEEvent;
          } catch { continue; }

          if (ev.type === "status" || ev.type === "turn" || ev.type === "reading" || ev.type === "committing" || ev.type === "staged") {
            setStreamMsg(ev.message ?? "");
            const entryType = (ev.type === "staged" ? "committing" : ev.type) as LogEntry["type"];
            setProgressLog(prev => [...prev, { text: ev.message ?? "", type: entryType }]);
            if (ev.type === "reading") setStatus("reading");
            else if (ev.type === "committing") setStatus("writing");
            else setStatus("thinking");
          } else if (ev.type === "done") {
            const hasChanges = (ev.filesChanged?.length ?? 0) > 0;
            const isStagedMode = !!ev.stagedId;
            setStatus(hasChanges && !isStagedMode ? "done" : "idle");
            setTimeout(() => setStatus("idle"), hasChanges && !isStagedMode ? 4000 : 0);
            setMessages(prev => [...prev, {
              role: "agent",
              content: ev.response ?? "",
              filesChanged: isStagedMode ? [] : (ev.filesChanged ?? []),
              diffs: isStagedMode ? [] : (ev.diffs ?? []),
              commitSha: ev.commitSha ?? undefined,
              model: ev.model ?? undefined,
              suggestions: ev.suggestions ?? [],
            }]);
            if (isStagedMode && hasChanges) {
              setPendingCommit({
                stagedId: ev.stagedId as string,
                filesChanged: ev.filesChanged ?? [],
                diffs: ev.diffs ?? [],
                committing: false,
              });
            }
            setStreamMsg("");
            setProgressLog([]);
            setIsPending(false);
            if (hasChanges && !isStagedMode && onAgentCommit) onAgentCommit();
            return;
          } else if (ev.type === "error") {
            throw new Error(ev.message ?? "Erreur agent");
          }

          if (ev.type === "done" || ev.type === "error") break outer;
        }
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Erreur de l'agent";
      setStatus("error");
      setProgressLog([]);
      setTimeout(() => setStatus("idle"), 4000);
      setMessages(prev => [...prev, { role: "agent", content: `❌ **Erreur :** ${msg}`, filesChanged: [] }]);
    } finally {
      setIsPending(false);
      setStreamMsg("");
      abortRef.current = null;
    }
  }, [input, imageDataUrl, isPending, currentPath, messages, selectedModel, onAgentCommit, confirmPush]);

  /* ---- Confirm staged commit ---- */
  const handleCommitStaged = useCallback(async () => {
    if (!pendingCommit) return;
    setPendingCommit(prev => prev ? { ...prev, committing: true } : null);
    try {
      const agentSecret2 = (() => { try { return localStorage.getItem("agent-ide-agent-secret") ?? undefined; } catch { return undefined; } })();
      const res = await fetch("/api/agent/commit-staged", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(agentSecret2 ? { "x-agent-secret": agentSecret2 } : {}),
        },
        body: JSON.stringify({ stagedId: pendingCommit.stagedId, _agentSecret: agentSecret2 }),
      });
      const data = await res.json() as { commitSha?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      /* Update the last agent message with commit info */
      setMessages(prev => {
        const updated = [...prev];
        const lastAgent = [...updated].reverse().find(m => m.role === "agent");
        if (lastAgent) {
          const idx = updated.lastIndexOf(lastAgent);
          updated[idx] = {
            ...lastAgent,
            filesChanged: pendingCommit.filesChanged,
            diffs: pendingCommit.diffs,
            commitSha: data.commitSha,
          };
        }
        return updated;
      });
      setPendingCommit(null);
      if (onAgentCommit) onAgentCommit();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur lors du commit";
      setPendingCommit(null);
      setMessages(prev => [...prev, { role: "agent", content: `❌ **Erreur de push :** ${msg}`, filesChanged: [] }]);
    }
  }, [pendingCommit, onAgentCommit]);

  /* ---- Toggle confirm-push mode ---- */
  const handleToggleConfirmPush = useCallback(() => {
    setConfirmPush(prev => {
      const next = !prev;
      try { localStorage.setItem("agent-ide-confirm-push", String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

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

  /* ---------------------------------------------------------------- */
  /*  Render                                                            */
  /* ---------------------------------------------------------------- */

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
              fontFamily: SANS, fontSize: 10.5,
              background: "#0d1117", color: "#8b949e",
              border: "1px solid #21262d", borderRadius: 5,
              padding: "2px 5px", cursor: "pointer",
              outline: "none",
            }}
          >
            {(Object.keys(MODEL_LABELS) as ModelChoice[]).map((m) => (
              <option key={m} value={m}>{MODEL_LABELS[m]}</option>
            ))}
          </select>

          {/* Confirm-push toggle */}
          <button
            onClick={handleToggleConfirmPush}
            title={confirmPush ? "Mode confirmation activé — cliquer pour auto-push" : "Auto-push activé — cliquer pour demander confirmation"}
            className="flex items-center justify-center rounded transition-colors"
            style={{
              width: 26, height: 26, border: "1px solid",
              borderColor: confirmPush ? "#e3b341" : "#21262d",
              background: confirmPush ? "#2d2100" : "transparent",
              color: confirmPush ? "#e3b341" : "#6e7681",
              borderRadius: 5,
            }}
          >
            <ShieldCheck className="w-3 h-3" />
          </button>

          {/* Reset button */}
          <button
            onClick={handleReset}
            title="Réinitialiser la conversation"
            className="flex items-center justify-center rounded hover:bg-white/5 transition-colors"
            style={{ width: 24, height: 24, color: "#6e7681" }}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Context file badge ── */}
      {currentPath && (
        <div
          className="flex items-center gap-1.5 px-3 shrink-0"
          style={{ height: 24, background: "#0d1117", borderBottom: "1px solid #21262d" }}
        >
          <FileCode style={{ width: 10, height: 10, color: "#61afef", flexShrink: 0 }} />
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#6e7681", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {currentPath}
          </span>
        </div>
      )}

      {/* ── Messages ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-10">
            <Bot className="w-8 h-8" style={{ color: "#3d444d" }} />
            <span style={{ fontFamily: SANS, fontSize: 12, color: "#6e7681", lineHeight: 1.5 }}>
              {repo
                ? "Posez une question ou demandez\nune modification sur votre projet."
                : "Connectez un dépôt GitHub pour\ncommencer à coder avec l'agent."}
            </span>
          </div>
        )}

        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div
                className="max-w-[85%] rounded-lg rounded-br-sm px-3 py-2"
                style={{ background: "#1f6feb", fontFamily: SANS, fontSize: 13, color: "#ffffff", lineHeight: 1.5 }}
              >
                {msg.imageDataUrl && (
                  <img src={msg.imageDataUrl} alt="shared" className="rounded mb-1.5 max-w-full max-h-32 object-contain" />
                )}
                {msg.contextFile && (
                  <div className="flex items-center gap-1 mb-1" style={{ fontSize: 10.5, opacity: 0.75, fontFamily: MONO }}>
                    <FileCode style={{ width: 9, height: 9 }} />
                    {msg.contextFile}
                  </div>
                )}
                <span className="whitespace-pre-wrap">{msg.content}</span>
              </div>
            </div>
          ) : (
            <AgentResultCard key={i} msg={msg} onSuggestion={(s) => { setInput(s); inputRef.current?.focus(); }} />
          )
        )}

        {/* Pending commit confirmation card */}
        {pendingCommit && !isPending && (
          <PendingCommitCard
            pending={pendingCommit}
            onCommit={handleCommitStaged}
            onCancel={() => setPendingCommit(null)}
          />
        )}

        {/* Live activity log */}
        {isPending && (
          <div className="flex items-start gap-2">
            {progressLog.length > 0
              ? <LiveActivity log={progressLog} status={status} />
              : (
                <div
                  className="w-full max-w-[95%] rounded-lg rounded-tl-sm px-3 py-2.5"
                  style={{ background: "#161b22", border: "1px solid #21262d" }}
                >
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" style={{ color: STATUS_COLORS[status] }} />
                    <span style={{ fontFamily: SANS, fontSize: 11.5, color: STATUS_COLORS[status] }}>
                      {STATUS_LABELS[status]}
                    </span>
                  </div>
                </div>
              )
            }
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div
        className="shrink-0 flex items-center justify-between px-3"
        style={{ height: 20, borderTop: "1px solid #21262d", background: "#0d1117" }}
      >
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: STATUS_COLORS[status] }}>
          ● {STATUS_LABELS[status]}
        </span>
        {/* LLM health badge */}
        <button
          onClick={async () => {
            if (healthLoading) return;
            setHealthLoading(true);
            try {
              const r = await fetch("/api/agent/health");
              const d = await r.json() as { providers: ProviderStatus[] };
              setLlmHealth(d.providers);
            } catch { setLlmHealth(null); }
            finally { setHealthLoading(false); }
          }}
          title="Vérifier le statut des APIs IA"
          style={{
            display: "flex", alignItems: "center", gap: 4, background: "none",
            border: "none", cursor: "pointer", padding: "0 2px",
          }}
        >
          {healthLoading ? (
            <Loader2 style={{ width: 8, height: 8, color: "#6e7681" }} className="animate-spin" />
          ) : llmHealth ? (
            <>
              {llmHealth.map((p) => (
                <span
                  key={p.name}
                  title={p.ok ? `${p.name} ✓ ${p.latency}ms` : `${p.name} ✗ ${p.error ?? ""}`}
                  style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: p.error === "Clé non configurée" ? "#3d444d" : p.ok ? "#3fb950" : "#f85149",
                    display: "inline-block",
                  }}
                />
              ))}
            </>
          ) : (
            <span style={{ fontFamily: MONO, fontSize: 9, color: "#3d444d" }}>IA ?</span>
          )}
        </button>
      </div>

      {/* ── Input area ── */}
      <div
        className="shrink-0"
        style={{ borderTop: "1px solid #21262d", padding: "8px 10px 10px", background: "#010409" }}
      >
        {imageDataUrl && (
          <div className="relative inline-block mb-2">
            <img src={imageDataUrl} alt="preview" className="h-12 rounded border border-white/10 object-contain" />
            <button
              onClick={() => setImageDataUrl(null)}
              className="absolute -top-1 -right-1 rounded-full flex items-center justify-center"
              style={{ width: 14, height: 14, background: "#f85149", color: "white" }}
            >
              <X style={{ width: 8, height: 8 }} />
            </button>
          </div>
        )}

        {/* @ mention dropdown */}
        {atSuggestions.length > 0 && (
          <div
            className="mb-1 rounded-md overflow-hidden border border-white/10"
            style={{ background: "#161b22", maxHeight: 140, overflowY: "auto" }}
          >
            {atSuggestions.map((f, idx) => (
              <div
                key={f}
                onClick={() => insertAtMention(f)}
                style={{
                  padding: "4px 10px", cursor: "pointer", fontSize: 11.5, fontFamily: MONO,
                  background: idx === atDropdownIdx ? "rgba(97,175,239,0.12)" : "transparent",
                  color: "#c9d1d9",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(97,175,239,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = idx === atDropdownIdx ? "rgba(97,175,239,0.12)" : "transparent")}
              >
                {f}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1.5 items-end">
          <div className="relative flex-1">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
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
