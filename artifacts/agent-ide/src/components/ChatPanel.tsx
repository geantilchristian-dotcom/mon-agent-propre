import React, { useState, useRef, useEffect } from "react";
import { useSendChatMessage, useResetChat, useReadGithubFile, getReadGithubFileQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, RotateCcw, Bot, User, FileCode, Paperclip, X, Check } from "lucide-react";

interface ChatPanelProps {
  currentPath: string | null;
  onApplyCode?: (code: string) => void;
}

interface Message {
  role: "user" | "ai";
  content: string;
  contextFile?: string;
  imageThumbnail?: string;
}

export function ChatPanel({ currentPath, onApplyCode }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const sendMutation = useSendChatMessage();
  const resetMutation = useResetChat();
  
  const { data: fileData } = useReadGithubFile(
    { path: currentPath || "" },
    { query: { enabled: !!currentPath, queryKey: getReadGithubFileQueryKey({ path: currentPath || "" }) } }
  );

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sendMutation.isPending]);

  const handleSend = () => {
    if (!input.trim() && !imageBase64) return;
    if (sendMutation.isPending) return;
    
    const userMsg = input;
    const fileContent = currentPath && fileData?.content ? fileData.content : undefined;
    const fileName = currentPath || undefined;
    const thumbnail = imageBase64 ? `data:${imageMime};base64,${imageBase64}` : undefined;
    
    setMessages(prev => [...prev, { role: "user", content: userMsg, contextFile: fileName, imageThumbnail: thumbnail }]);
    setInput("");
    
    const payloadImageBase64 = imageBase64;
    const payloadImageMime = imageMime;
    
    setImageBase64(null);
    setImageMime(null);
    
    sendMutation.mutate(
      { data: { message: userMsg, fileContent, fileName, imageBase64: payloadImageBase64, imageMime: payloadImageMime } },
      {
        onSuccess: (data) => {
          setMessages(prev => [...prev, { role: "ai", content: data.response }]);
        }
      }
    );
  };

  const handleReset = () => {
    resetMutation.mutate(undefined, {
      onSuccess: () => {
        setMessages([]);
      }
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      setImageBase64(base64);
      setImageMime(file.type);
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col h-full bg-sidebar/50">
      <div className="p-3 border-b border-border flex items-center justify-between bg-muted/30 shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center">
          <Bot className="w-3.5 h-3.5 mr-2" />
          Agent Chat
        </h2>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-6 w-6" 
          onClick={handleReset}
          disabled={resetMutation.isPending}
          title="Reset Chat"
          data-testid="button-reset-chat"
        >
          {resetMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6" ref={scrollRef}>
        {!currentPath && messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center space-y-3">
            <FileCode className="w-8 h-8 opacity-20" />
            <p className="text-sm px-4">Open a file to give the AI context about your code.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center space-y-3">
            <Bot className="w-8 h-8 opacity-20" />
            <p className="text-sm px-4">I'm ready to help you with your code.<br/>Ask me anything.</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div 
                className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user" 
                    ? "bg-primary text-primary-foreground rounded-tr-sm" 
                    : "bg-muted text-foreground rounded-tl-sm"
                }`}
              >
                {msg.imageThumbnail && (
                  <img src={msg.imageThumbnail} alt="User upload" className="max-w-[150px] rounded-md mb-2 object-contain" />
                )}
                {msg.role === "ai" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {/* Minimal markdown rendering for code blocks */}
                    {msg.content.split('```').map((part, index) => {
                      if (index % 2 === 1) {
                        // It's a code block
                        const lines = part.split('\n');
                        const lang = lines[0];
                        const code = lines.slice(1).join('\n');
                        return (
                          <div key={index} className="relative group my-2">
                            <pre className="bg-background/50 p-2 rounded text-xs font-mono overflow-x-auto border border-border pb-8">
                              <code>{code}</code>
                            </pre>
                            <Button 
                              size="sm" 
                              variant="secondary" 
                              className="absolute bottom-2 right-2 h-6 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => onApplyCode && onApplyCode(code)}
                            >
                              <Check className="w-3 h-3 mr-1" /> Apply
                            </Button>
                          </div>
                        );
                      }
                      return <span key={index} className="whitespace-pre-wrap">{part}</span>;
                    })}
                  </div>
                ) : (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                )}
              </div>
              {msg.contextFile && (
                <div className="mt-1 flex items-center text-[10px] text-muted-foreground">
                  <FileCode className="w-3 h-3 mr-1" />
                  {msg.contextFile}
                </div>
              )}
            </div>
          ))
        )}
        
        {sendMutation.isPending && (
          <div className="flex items-start">
            <div className="bg-muted text-foreground rounded-lg rounded-tl-sm px-4 py-3 text-sm flex items-center">
              <span className="flex space-x-1">
                <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce"></span>
                <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></span>
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border shrink-0 bg-background flex flex-col">
        {currentPath && (
          <div className="mb-2 flex items-center text-xs text-primary/80 bg-primary/10 px-2 py-1 rounded-sm w-fit">
            <FileCode className="w-3 h-3 mr-1.5" />
            <span>Context: {currentPath.split('/').pop()}</span>
          </div>
        )}
        
        {imageBase64 && (
          <div className="mb-2 relative w-16 h-16 rounded-md border border-border overflow-hidden group">
            <img src={`data:${imageMime};base64,${imageBase64}`} className="w-full h-full object-cover" alt="Upload preview" />
            <button 
              className="absolute top-1 right-1 bg-black/50 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => { setImageBase64(null); setImageMime(null); }}
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        )}

        <div className="relative flex items-center gap-2">
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleImageUpload}
          />
          <Button 
            size="icon" 
            variant="ghost" 
            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="w-4 h-4" />
          </Button>

          <Textarea 
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about the code..."
            className="pr-10 min-h-[40px] py-2 max-h-[200px] resize-none text-sm bg-muted/30 border-muted-foreground/20 focus-visible:ring-primary/50"
            data-testid="input-chat-message"
          />
          <Button 
            size="icon" 
            variant="ghost"
            className="absolute right-2 bottom-1.5 h-6 w-6 text-primary hover:text-primary hover:bg-primary/20" 
            onClick={handleSend}
            disabled={(!input.trim() && !imageBase64) || sendMutation.isPending}
            data-testid="button-send-chat"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
