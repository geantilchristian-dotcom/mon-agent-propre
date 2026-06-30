import React, { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Editor } from "@/components/Editor";
import { ChatPanel } from "@/components/ChatPanel";
import { useConfigureGithub } from "@workspace/api-client-react";
import { X } from "lucide-react";

const STORAGE_KEY = "agent-ide-github-config";

function getFileIcon(name: string): { icon: string; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, { icon: string; color: string }> = {
    tsx:  { icon: "⚛", color: "#61AFEF" },
    jsx:  { icon: "⚛", color: "#61AFEF" },
    ts:   { icon: "TS", color: "#3178C6" },
    js:   { icon: "JS", color: "#F7DF1E" },
    json: { icon: "{}", color: "#98C379" },
    css:  { icon: "✦", color: "#C678DD" },
    scss: { icon: "✦", color: "#C678DD" },
    html: { icon: "<>", color: "#E06C75" },
    md:   { icon: "M↓", color: "#ABB2BF" },
    yaml: { icon: "≡",  color: "#E5C07B" },
    yml:  { icon: "≡",  color: "#E5C07B" },
    env:  { icon: "⚙",  color: "#98C379" },
    sh:   { icon: "$",  color: "#3FB950" },
    py:   { icon: "Py", color: "#3572A5" },
  };
  return map[ext] ?? { icon: "·", color: "#8b949e" };
}

export function Home() {
  const [connected, setConnected] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
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

  const handleSelectFile = (path: string) => {
    setCurrentPath(path);
    setOpenTabs(prev => prev.includes(path) ? prev : [...prev, path]);
  };

  const handleCloseTab = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const next = openTabs.filter(t => t !== path);
    setOpenTabs(next);
    if (currentPath === path) {
      setCurrentPath(next.length > 0 ? next[next.length - 1]! : null);
    }
  };

  return (
    <div
      className="flex flex-col h-screen w-full overflow-hidden"
      style={{ background: "#010409", color: "#c9d1d9" }}
      data-testid="ide-container"
    >
      {/* Banner */}
      {banner && (
        <div style={{
          position: "fixed", top: "1rem", left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "0.4rem 1.2rem", borderRadius: "6px",
          background: banner.ok ? "#166534" : "#7f1d1d",
          color: "white", fontSize: "0.8rem", fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}>
          {banner.text}
        </div>
      )}

      {/* Top toolbar */}
      <div
        className="flex items-center px-3 gap-3 shrink-0"
        style={{ height: 40, background: "#010409", borderBottom: "1px solid #21262d" }}
      >
        <div className="flex items-center gap-1.5">
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <div style={{ width: 1, height: 20, background: "#21262d" }} />
        <div
          className="flex items-center gap-1.5 text-xs"
          style={{ color: "#8b949e", background: "#161b22", padding: "3px 10px", borderRadius: 6, border: "1px solid #30363d" }}
        >
          <span style={{ color: "#3fb950" }}>⎇</span>
          <span>Agent IDE</span>
          <span style={{ color: "#6e7681" }}>· main</span>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div style={{ width: 220, background: "#010409", borderRight: "1px solid #21262d", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <Sidebar
            connected={connected}
            onConnect={handleConnect}
            currentPath={currentPath}
            onSelectFile={handleSelectFile}
            isConnecting={configureMutation.isPending}
            onNotify={showBanner}
          />
        </div>

        {/* Editor column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* File tabs */}
          {openTabs.length > 0 && (
            <div
              className="flex items-stretch shrink-0 overflow-x-auto"
              style={{ height: 36, background: "#010409", borderBottom: "1px solid #21262d" }}
            >
              {openTabs.map(tab => {
                const name = tab.split("/").pop() ?? tab;
                const { icon, color } = getFileIcon(name);
                const isActive = currentPath === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setCurrentPath(tab)}
                    title={tab}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "0 14px", borderRight: "1px solid #21262d",
                      fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap",
                      color: isActive ? "#c9d1d9" : "#8b949e",
                      background: isActive ? "#0d1117" : "transparent",
                      borderBottom: isActive ? "2px solid #61afef" : "none",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    <span style={{ color, fontSize: 11, fontFamily: "sans-serif" }}>{icon}</span>
                    <span>{name}</span>
                    <span
                      onClick={(e) => handleCloseTab(e, tab)}
                      title="Fermer"
                      style={{
                        marginLeft: 2, color: "#6e7681", fontSize: 15, lineHeight: 1,
                        display: "flex", alignItems: "center",
                      }}
                    >
                      <X style={{ width: 12, height: 12 }} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <Editor
              currentPath={currentPath}
              connected={connected}
              appliedCode={appliedCode}
              onApplied={() => setAppliedCode(null)}
            />
          </div>
        </div>

        {/* Agent panel */}
        <div style={{ width: 320, borderLeft: "1px solid #21262d", display: "flex", flexDirection: "column", flexShrink: 0, background: "#010409" }}>
          <ChatPanel currentPath={currentPath} onApplyCode={setAppliedCode} />
        </div>
      </div>
    </div>
  );
}
