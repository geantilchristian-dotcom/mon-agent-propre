import React, { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Editor } from "@/components/Editor";
import { ChatPanel } from "@/components/ChatPanel";
import { useConfigureGithub } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export function Home() {
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState({ token: "", repo: "" });
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  
  const { toast } = useToast();
  const configureMutation = useConfigureGithub();

  const handleConnect = (token: string, repo: string) => {
    configureMutation.mutate(
      { data: { token, repo } },
      {
        onSuccess: () => {
          setConfig({ token, repo });
          setConnected(true);
          toast({ title: "Connected to GitHub successfully" });
        },
        onError: () => {
          toast({ title: "Failed to connect", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground" data-testid="ide-container">
      {/* Left Sidebar */}
      <div className="w-64 border-r border-border shrink-0 flex flex-col bg-sidebar">
        <Sidebar 
          connected={connected} 
          onConnect={handleConnect} 
          currentPath={currentPath}
          onSelectFile={setCurrentPath} 
          isConnecting={configureMutation.isPending}
        />
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-background relative">
        <Editor 
          currentPath={currentPath} 
          connected={connected}
          appliedCode={appliedCode}
          onApplied={() => setAppliedCode(null)}
        />
      </div>

      {/* Right Chat Panel */}
      <div className="w-80 border-l border-border shrink-0 flex flex-col bg-sidebar">
        <ChatPanel 
          currentPath={currentPath}
          onApplyCode={setAppliedCode}
        />
      </div>
    </div>
  );
}
