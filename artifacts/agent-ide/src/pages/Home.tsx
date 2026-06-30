import React, { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Editor } from "@/components/Editor";
import { ChatPanel } from "@/components/ChatPanel";
import { useConfigureGithub } from "@workspace/api-client-react";

const STORAGE_KEY = "agent-ide-github-config";

export function Home() {
  const [connected, setConnected] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ text: string; ok: boolean } | null>(null);

  const configureMutation = useConfigureGithub();

  const showBanner = (text: string, ok: boolean) => {
    setBanner({ text, ok });
    setTimeout(() => setBanner(null), 3500);
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const { token, repo } = JSON.parse(saved) as { token: string; repo: string };
        if (token && repo) {
          configureMutation.mutate(
            { data: { token, repo } },
            { onSuccess: () => setConnected(true) }
          );
        }
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = (token: string, repo: string) => {
    configureMutation.mutate(
      { data: { token, repo } },
      {
        onSuccess: () => {
          setConnected(true);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, repo })); } catch { /* ignore */ }
          showBanner("Connecté à GitHub ✓", true);
        },
        onError: () => showBanner("Échec de connexion GitHub", false),
      }
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground" data-testid="ide-container">
      {banner && (
        <div style={{
          position: "fixed", top: "1rem", left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "0.5rem 1.25rem", borderRadius: "6px",
          background: banner.ok ? "#166534" : "#7f1d1d",
          color: "white", fontSize: "0.85rem", fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}>
          {banner.text}
        </div>
      )}

      <div className="w-64 border-r border-border shrink-0 flex flex-col bg-sidebar">
        <Sidebar
          connected={connected}
          onConnect={handleConnect}
          currentPath={currentPath}
          onSelectFile={setCurrentPath}
          isConnecting={configureMutation.isPending}
          onNotify={showBanner}
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
        <ChatPanel currentPath={currentPath} onApplyCode={setAppliedCode} />
      </div>
    </div>
  );
}
