import React, { useState, useEffect } from "react";
  import { Sidebar } from "@/components/Sidebar";
  import { Editor } from "@/components/Editor";
  import { ChatPanel } from "@/components/ChatPanel";
  import { useConfigureGithub } from "@workspace/api-client-react";
  import { useToast } from "@/hooks/use-toast";

  const STORAGE_KEY = "agent-ide-github-config";

  export function Home() {
    const [connected, setConnected] = useState(false);
    const [config, setConfig] = useState({ token: "", repo: "" });
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [appliedCode, setAppliedCode] = useState<string | null>(null);

    const { toast } = useToast();
    const configureMutation = useConfigureGithub();

    // On mount, restore saved config and re-configure server
    useEffect(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const { token, repo } = JSON.parse(saved) as { token: string; repo: string };
          if (token && repo) {
            configureMutation.mutate(
              { data: { token, repo } },
              {
                onSuccess: () => {
                  setConfig({ token, repo });
                  setConnected(true);
                },
              }
            );
          }
        }
      } catch {
        // ignore
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleConnect = (token: string, repo: string) => {
      configureMutation.mutate(
        { data: { token, repo } },
        {
          onSuccess: () => {
            setConfig({ token, repo });
            setConnected(true);
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, repo }));
            } catch {
              // ignore
            }
            toast({ title: "Connected to GitHub successfully" });
          },
          onError: () => {
            toast({ title: "Failed to connect", variant: "destructive" });
          },
        }
      );
    };

    return (
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground" data-testid="ide-container">
        <div className="w-64 border-r border-border shrink-0 flex flex-col bg-sidebar">
          <Sidebar
            connected={connected}
            onConnect={handleConnect}
            currentPath={currentPath}
            onSelectFile={setCurrentPath}
            isConnecting={configureMutation.isPending}
          />
        </div>

        <div className="flex-1 flex flex-col min-w-0 bg-background relative">
          <Editor
            currentPath={currentPath}
            connected={connected}
            appliedCode={appliedCode}
            onApplied={() => setAppliedCode(null)}
          />
        </div>

        <div className="w-80 border-l border-border shrink-0 flex flex-col bg-sidebar">
          <ChatPanel
            currentPath={currentPath}
            onApplyCode={setAppliedCode}
          />
        </div>
      </div>
    );
  }
  