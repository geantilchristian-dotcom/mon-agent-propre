import React, { useState, useRef, useEffect } from "react";
  import { useSendChatMessage, useResetChat, useReadGithubFile, getReadGithubFileQueryKey } from "@workspace/api-client-react";
  import { Button } from "@/components/ui/button";
  import { Textarea } from "@/components/ui/textarea";
  import { Loader2, Send, RotateCcw, Bot, FileCode, Paperclip, X, Check, Zap, Copy } from "lucide-react";
  import SyntaxHighlighter from "react-syntax-highlighter";
  import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";

  interface ChatPanelProps {
    currentPath: string | null;
    onApplyCode?: (code: string) => void;
  }

  interface Message {
    role: "user" | "ai";
    content: string;
    contextFile?: string;
    imageThumbnail?: string;
    model?: string;
  }

  type ModelStatus = "idle" | "thinking" | "ok" | "error";

  function CopyButton({ text, className = "" }: { text: string; className?: string }) {
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
          ${copied ? "text-green-400" : "text-muted-foreground hover:text-foreground"}
          ${className}`}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? "Copié !" : "Copier"}
      </button>
    );
  }

  function CodeBlock({ lang, code, onApply }: { lang: string; code: string; onApply?: (c: string) => void }) {
    const [applied, setApplied] = useState(false);

    const handleApply = () => {
      if (onApply) { onApply(code); setApplied(true); setTimeout(() => setApplied(false), 1800); }
    };

    const displayLang = lang || "text";

    return (
      <div className="my-2 rounded-lg overflow-hidden border border-border/60">
        {/* Top bar */}
        <div className="flex items-center justify-between px-3 py-1 bg-zinc-800 border-b border-border/40">
          <span className="text-[10px] font-mono text-zinc-400">{displayLang}</span>
          <div className="flex items-center gap-1">
            <CopyButton text={code} />
            {onApply && (
              <button
                onClick={handleApply}
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors
                  ${applied ? "text-green-400" : "text-blue-400 hover:text-blue-300"}`}
              >
                {applied ? <Check className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                {applied ? "Appliqué !" : "Appliquer"}
              </button>
            )}
          </div>
        </div>
        {/* Highlighted code */}
        <SyntaxHighlighter
          language={displayLang}
          style={atomOneDark}
          customStyle={{
            margin: 0,
            padding: "0.75rem",
            fontSize: "0.75rem",
            lineHeight: "1.5",
            background: "#1a1b26",
            maxHeight: "400px",
            overflowY: "auto",
          }}
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
      </div>
    );
  }

  /** Parse markdown — split on triple-backtick fences */
  function parseContent(content: string, onApply?: (c: string) => void) {
    const parts: React.ReactNode[] = [];
    const regex = /```([\w+-]*)\n?([\s\S]*?)```/g;
    let last = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const before = content.slice(last, match.index);
      if (before) parts.push(<span key={`t-${match.index}`} className="whitespace-pre-wrap">{before}</span>);
      parts.push(
        <CodeBlock key={`c-${match.index}`} lang={match[1] ?? ""} code={match[2] ?? ""} onApply={onApply} />
      );
      last = match.index + match[0].length;
    }

    const tail = content.slice(last);
    if (tail) parts.push(<span key="tail" className="whitespace-pre-wrap">{tail}</span>);
    return parts;
  }

  export function ChatPanel({ currentPath, onApplyCode }: ChatPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [imageBase64, setImageBase64] = useState<string | null>(null);
    const [imageMime, setImageMime] = useState<string | null>(null);
    const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
    const [activeModel, setActiveModel] = useState<string>("Groq · Llama 3.3 70B");
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const sendMutation = useSendChatMessage();
    const resetMutation = useResetChat();

    const { data: fileData } = useReadGithubFile(
      { path: currentPath || "" },
      { query: { enabled: !!currentPath, queryKey: getReadGithubFileQueryKey({ path: currentPath || "" }) } }
    );

    useEffect(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, sendMutation.isPending]);

    useEffect(() => {
      if (sendMutation.isPending) setModelStatus("thinking");
      else if (sendMutation.isError) setModelStatus("error");
      else if (sendMutation.isSuccess) setModelStatus("ok");
      else setModelStatus("idle");
    }, [sendMutation.isPending, sendMutation.isError, sendMutation.isSuccess]);

    const handleSend = () => {
      if (!input.trim() && !imageBase64) return;
      if (sendMutation.isPending) return;

      const userMsg = input;
      const fileContent = currentPath && fileData?.content ? fileData.content : undefined;
      const fileName = currentPath || undefined;
      const thumbnail = imageBase64 ? `data:${imageMime};base64,${imageBase64}` : undefined;

      setMessages(prev => [...prev, { role: "user", content: userMsg, contextFile: fileName, imageThumbnail: thumbnail }]);
      setInput("");

      const pImg = imageBase64;
      const pMime = imageMime;
      setImageBase64(null);
      setImageMime(null);

      sendMutation.mutate(
        { data: { message: userMsg, fileContent, fileName, imageBase64: pImg, imageMime: pMime } },
        {
          onSuccess: (data) => {
            const d = data as { response: string; model?: string };
            if (d.model) setActiveModel(d.model);
            setMessages(prev => [...prev, { role: "ai", content: d.response, model: d.model }]);
          },
        }
      );
    };

    const handleReset = () => {
      resetMutation.mutate(undefined, {
        onSuccess: () => { setMessages([]); setModelStatus("idle"); }
      });
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(",")[1];
        setImageBase64(base64);
        setImageMime(file.type);
      };
      reader.readAsDataURL(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const statusDot: Record<ModelStatus, { color: string; label: string; pulse: boolean }> = {
      idle:     { color: "bg-muted-foreground/40", label: "Prêt",           pulse: false },
      thinking: { color: "bg-yellow-400",          label: "Génère...",       pulse: true  },
      ok:       { color: "bg-green-400",            label: "Réponse reçue",  pulse: false },
      error:    { color: "bg-red-400",              label: "Erreur",          pulse: false },
    };
    const { color, label, pulse } = statusDot[modelStatus];

    return (
      <div className="flex flex-col h-full bg-sidebar/50">
        {/* Header */}
        <div className="p-3 border-b border-border flex items-center justify-between bg-muted/30 shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center">
            <Bot className="w-3.5 h-3.5 mr-2" />
            Agent Chat
          </h2>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleReset}
            disabled={resetMutation.isPending} title="Réinitialiser" data-testid="button-reset-chat">
            {resetMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4" ref={scrollRef}>
          {!currentPath && messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center space-y-3">
              <FileCode className="w-8 h-8 opacity-20" />
              <p className="text-sm px-4">Ouvrez un fichier pour donner du contexte à l'IA.</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center space-y-3">
              <Bot className="w-8 h-8 opacity-20" />
              <p className="text-sm px-4">Je suis prêt à vous aider avec votre code.<br />Posez-moi une question.</p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                {msg.role === "user" ? (
                  <div className="group relative max-w-[90%]">
                    <div className="bg-primary text-primary-foreground rounded-lg rounded-tr-sm px-3 py-2 text-sm">
                      {msg.imageThumbnail && (
                        <img src={msg.imageThumbnail} alt="Upload" className="max-w-[150px] rounded-md mb-2 object-contain" />
                      )}
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </div>
                    <div className="flex justify-end mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <CopyButton text={msg.content} />
                    </div>
                  </div>
                ) : (
                  <div className="group w-full max-w-[95%]">
                    <div className="bg-muted text-foreground rounded-lg rounded-tl-sm px-3 py-2 text-sm">
                      {parseContent(msg.content, onApplyCode)}
                    </div>
                    <div className="flex items-center justify-between mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] text-muted-foreground/50 pl-1">{msg.model ?? activeModel}</span>
                      <CopyButton text={msg.content} />
                    </div>
                  </div>
                )}
                {msg.contextFile && (
                  <div className="mt-0.5 flex items-center text-[10px] text-muted-foreground">
                    <FileCode className="w-3 h-3 mr-1" />{msg.contextFile}
                  </div>
                )}
              </div>
            ))
          )}

          {sendMutation.isPending && (
            <div className="flex items-start">
              <div className="bg-muted text-foreground rounded-lg rounded-tl-sm px-4 py-3 text-sm">
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
        <div className="p-3 border-t border-border shrink-0 bg-background flex flex-col">
          {currentPath && (
            <div className="mb-2 flex items-center text-xs text-primary/80 bg-primary/10 px-2 py-1 rounded-sm w-fit">
              <FileCode className="w-3 h-3 mr-1.5" />
              <span>Contexte : {currentPath.split("/").pop()}</span>
            </div>
          )}
          {imageBase64 && (
            <div className="mb-2 relative w-16 h-16 rounded-md border border-border overflow-hidden group">
              <img src={`data:${imageMime};base64,${imageBase64}`} className="w-full h-full object-cover" alt="Aperçu" />
              <button className="absolute top-1 right-1 bg-black/50 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => { setImageBase64(null); setImageMime(null); }}>
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          )}
          <div className="relative flex items-center gap-2">
            <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="w-4 h-4" />
            </Button>
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Posez une question sur le code..."
              className="pr-10 min-h-[40px] py-2 max-h-[200px] resize-none text-sm bg-muted/30 border-muted-foreground/20 focus-visible:ring-primary/50"
              data-testid="input-chat-message"
            />
            <Button size="icon" variant="ghost"
              className="absolute right-2 bottom-1.5 h-6 w-6 text-primary hover:text-primary hover:bg-primary/20"
              onClick={handleSend}
              disabled={(!input.trim() && !imageBase64) || sendMutation.isPending}
              data-testid="button-send-chat">
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Status bar */}
        <div className="px-3 py-1.5 border-t border-border bg-muted/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-blue-400" />
            <span className="text-[10px] font-medium text-muted-foreground">{activeModel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground/60">{label}</span>
            <span className={`w-1.5 h-1.5 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`} />
          </div>
        </div>
      </div>
    );
  }
  