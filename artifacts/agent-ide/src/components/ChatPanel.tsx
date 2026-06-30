import React, { useState, useRef, useEffect } from "react";
import { useRunAgent, useResetChat, useReadGithubFile, getReadGithubFileQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Send, RotateCcw, Bot, FileCode, Check, Zap, Copy,
  GitCommit, FilePlus, FilePen, FileX, ExternalLink,
} from "lucide-react";

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
  isThinking?: boolean;
}

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
      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors
        ${copied ? "text-green-400" : "text-zinc-400 hover:text-white"}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copié !" : "Copier"}
    </button>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-white/10">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-white/10">
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{lang || "text"}</span>
        <CopyButton text={code} />
      </div>
      <pre
        className="overflow-auto text-[0.72rem] leading-relaxed font-mono text-zinc-100 p-3 m-0"
        style={{ background: "#0d1117", maxHeight: "360px" }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function parseContent(content: string) {
  const parts: React.ReactNode[] = [];
  const regex = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const before = content.slice(last, match.index);
    if (before) parts.push(<span key={`t-${match.index}`} className="whitespace-pre-wrap">{before}</span>);
    parts.push(<CodeBlock key={`c-${match.index}`} lang={match[1] ?? ""} code={match[2] ?? ""} />);
    last = match.index + match[0].length;
  }

  const tail = content.slice(last);
  if (tail) parts.push(<span key="tail" className="whitespace-pre-wrap">{tail}</span>);
  return parts;
}

function FileChangeBadge({ path }: { path: string }) {
  const ext = path.split(".").pop() ?? "";
  const isNew = false;
  const isDelete = false;

  const Icon = isDelete ? FileX : isNew ? FilePlus : FilePen;
  const color = isDelete ? "text-red-400" : isNew ? "text-green-400" : "text-blue-400";

  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-mono ${color} py-0.5`}>
      <Icon className="w-3 h-3 shrink-0" />
      <span className="truncate">{path}</span>
    </div>
  );
}

function AgentResultCard({ msg }: { msg: Message }) {
  const hasChanges = (msg.filesChanged?.length ?? 0) > 0;
  const repoUrl = "https://github.com/geantilchristian-dotcom/mon-agent-propre";

  return (
    <div className="group w-full max-w-[95%]">
      <div className="bg-muted rounded-lg rounded-tl-sm overflow-hidden text-sm">
        {/* AI explanation */}
        <div className="px-3 pt-3 pb-2 text-foreground">
          {parseContent(msg.content)}
        </div>

        {/* Changed files panel */}
        {hasChanges && (
          <div className="border-t border-white/5 bg-black/20 px-3 py-2">
            <div className="flex items-center gap-2 mb-1.5">
              <GitCommit className="w-3.5 h-3.5 text-green-400" />
              <span className="text-[11px] font-semibold text-green-400 uppercase tracking-wider">
                {msg.filesChanged!.length} fichier{msg.filesChanged!.length > 1 ? "s" : ""} modifié{msg.filesChanged!.length > 1 ? "s" : ""}
              </span>
              {msg.commitSha && (
                <a
                  href={`${repoUrl}/commit/${msg.commitSha}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Voir sur GitHub
                </a>
              )}
            </div>
            <div className="space-y-0.5">
              {msg.filesChanged!.map((f) => (
                <FileChangeBadge key={f} path={f} />
              ))}
            </div>
            {msg.commitSha && (
              <div className="mt-2 text-[10px] text-muted-foreground font-mono">
                commit <span className="text-zinc-300">{msg.commitSha.slice(0, 7)}</span> — Render redéployera automatiquement
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] text-muted-foreground/50 pl-1 flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" />{msg.model ?? "Agent IA"}
        </span>
        <CopyButton text={msg.content} />
      </div>
    </div>
  );
}

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
  idle:     "bg-muted-foreground/40",
  thinking: "bg-yellow-400",
  reading:  "bg-blue-400",
  writing:  "bg-orange-400",
  done:     "bg-green-400",
  error:    "bg-red-400",
};

export function ChatPanel({ currentPath }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<AgentStatus>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const agentMutation = useRunAgent();
  const resetMutation = useResetChat();

  const { data: fileData } = useReadGithubFile(
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
    <div className="flex flex-col h-full bg-sidebar/50">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between bg-muted/30 shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Bot className="w-3.5 h-3.5" />
          Agent IA
        </h2>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleReset}
          disabled={resetMutation.isPending || isPending} title="Réinitialiser">
          {resetMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center space-y-3 px-4">
            <Bot className="w-10 h-10 opacity-15" />
            <div>
              <p className="text-sm font-medium mb-1">Agent de codage autonome</p>
              <p className="text-xs opacity-70">
                Demandez-moi d'ajouter, modifier ou supprimer quelque chose dans votre projet. Je lis le code, applique les changements et les pousse directement sur GitHub.
              </p>
            </div>
            <div className="text-xs text-muted-foreground/50 space-y-1 text-left bg-muted/20 rounded p-3 w-full">
              <p className="font-medium mb-2 text-muted-foreground">Exemples :</p>
              {[
                "Ajoute un bouton de dark mode dans le header",
                "Corrige l'erreur dans Sidebar.tsx",
                "Crée un composant Modal réutilisable",
                "Refactorise les appels API en custom hooks",
              ].map((ex) => (
                <button
                  key={ex}
                  className="block w-full text-left hover:text-foreground transition-colors py-0.5"
                  onClick={() => { setInput(ex); inputRef.current?.focus(); }}
                >
                  → {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
              {msg.role === "user" ? (
                <div className="max-w-[90%]">
                  <div className="bg-primary text-primary-foreground rounded-lg rounded-tr-sm px-3 py-2 text-sm whitespace-pre-wrap">
                    {msg.content}
                  </div>
                  {msg.contextFile && (
                    <div className="mt-0.5 flex items-center justify-end text-[10px] text-muted-foreground">
                      <FileCode className="w-3 h-3 mr-1" />{msg.contextFile}
                    </div>
                  )}
                </div>
              ) : (
                <AgentResultCard msg={msg} />
              )}
            </div>
          ))
        )}

        {/* Thinking animation */}
        {isPending && (
          <div className="flex items-start">
            <div className="bg-muted text-foreground rounded-lg rounded-tl-sm px-4 py-3 text-sm max-w-[90%]">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{STATUS_LABELS[status]}</span>
              </div>
              <span className="flex space-x-1">
                <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0.4s" }} />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border shrink-0 bg-background">
        {currentPath && (
          <div className="mb-2 flex items-center text-xs text-primary/80 bg-primary/10 px-2 py-1 rounded-sm w-fit">
            <FileCode className="w-3 h-3 mr-1.5" />
            <span>Contexte : {currentPath.split("/").pop()}</span>
          </div>
        )}
        <div className="relative flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Demandez une modification, ajout ou suppression…"
            className="pr-10 min-h-[40px] py-2 max-h-[180px] resize-none text-sm bg-muted/30 border-muted-foreground/20 focus-visible:ring-primary/50"
            disabled={isPending}
            data-testid="input-chat-message"
          />
          <Button size="icon" variant="ghost"
            className="absolute right-2 bottom-1.5 h-6 w-6 text-primary hover:text-primary hover:bg-primary/20"
            onClick={handleSend}
            disabled={!input.trim() || isPending}
            data-testid="button-send-chat">
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-center">
          L'agent lit votre projet, applique les changements et commit sur GitHub
        </p>
      </div>

      {/* Status bar */}
      <div className="px-3 py-1.5 border-t border-border bg-muted/20 flex items-center gap-2 shrink-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[status]} ${
          isPending ? "animate-pulse" : ""
        }`} />
        <span className="text-[10px] text-muted-foreground truncate">{STATUS_LABELS[status]}</span>
      </div>
    </div>
  );
}
