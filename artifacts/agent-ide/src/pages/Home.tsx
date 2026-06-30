import React, { useState, useEffect, useRef } from "react";
import { Sidebar, saveRecentProject } from "@/components/Sidebar";
import { Editor, EditorHandle } from "@/components/Editor";
import { ChatPanel } from "@/components/ChatPanel";
import { FileSearch } from "@/components/FileSearch";
import { useConfigureGithub } from "@workspace/api-client-react";
import { GitBranch, Upload, Loader2, X } from "lucide-react";

const STORAGE_KEY = "agent-ide-github-config";

function getFileIcon(name: string): { icon: string; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, { icon: string; color: string }> = {
    tsx:  { icon: "⚛", color: "#61AFEF" }, jsx: { icon: "⚛", color: "#61AFEF" },
    ts:   { icon: "TS", color: "#3178C6" }, js:  { icon: "JS", color: "#F7DF1E" },
    json: { icon: "{}", color: "#98C379" }, css: { icon: "✦", color: "#C678DD" },
    scss: { icon: "✦", color: "#C678DD" }, html: { icon: "<>", color: "#E06C75" },
    md:   { icon: "M↓", color: "#ABB2BF" }, yaml: { icon: "≡", color: "#E5C07B" },
    yml:  { icon: "≡", color: "#E5C07B" },  env:  { icon: "⚙", color: "#98C379" },
    sh:   { icon: "$", color: "#3FB950" },   py:   { icon: "Py", color: "#3572A5" },
  };
  return map[ext] ?? { icon: "·", color: "#8b949e" };
}

export function Home() {
  const [connected, setConnected] = useState(false);
  const [repo, setRepo] = useState("");
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ text: string; ok: boolean } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [agentRefreshKey, setAgentRefreshKey] = useState(0);

  const editorRef = useRef<EditorHandle>(null);
  const configureMutation = useConfigureGithub();

  const showBanner = (text: string, ok: boolean) => {
    setBanner({ text, ok });
    setTimeout(() => setBanner(null), 3500);
  };

  /* ── Auto-reconnect from localStorage ── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const { token, repo: savedRepo } = JSON.parse(saved) as { token: string; repo: string };
        if (token && savedRepo) {
          configureMutation.mutate(
            { data: { token, repo: savedRepo } },
            { onSuccess: () => { setConnected(true); setRepo(savedRepo); } }
          );
        }
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Global keyboard shortcuts ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (connected) setShowSearch((v) => !v);
        return;
      }
      if (mod && e.key === "s") {
        e.preventDefault();
        editorRef.current?.save();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [connected]);

  const handleConnect = (token: string, repoName: string) => {
    configureMutation.mutate(
      { data: { token, repo: repoName } },
      {
        onSuccess: () => {
          setConnected(true);
          setRepo(repoName);
          saveRecentProject(repoName, token);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, repo: repoName })); } catch { /* ignore */ }
          showBanner(`Connecté à ${repoName} ✓`, true);
        },
        onError: () => showBanner("Échec de connexion GitHub", false),
      }
    );
  };

  const handleDisconnect = () => {
    setConnected(false);
    setRepo("");
    setCurrentPath(null);
    setOpenTabs([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
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

  const handlePush = () => editorRef.current?.save();

  const editorHandle = editorRef.current;
  const canPush = connected && !!currentPath && (editorHandle?.isDirty ?? false) && !(editorHandle?.isSaving ?? false);

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

      {/* File search overlay */}
      {showSearch && connected && (
        <FileSearch
          onSelect={handleSelectFile}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Top toolbar */}
      <div
        className="flex items-center px-3 gap-3 shrink-0"
        style={{ height: 40, background: "#010409", borderBottom: "1px solid #21262d" }}
      >
        {/* macOS-style dots */}
        <div className="flex items-center gap-1.5">
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <div style={{ width: 1, height: 20, background: "#21262d" }} />

        {/* Branch + repo badge */}
        <div
          className="flex items-center gap-1.5 text-xs"
          style={{ color: "#8b949e", background: "#161b22", padding: "3px 10px", borderRadius: 6, border: "1px solid #30363d" }}
        >
          <GitBranch style={{ width: 11, height: 11, color: "#3fb950" }} />
          <span>main</span>
          {repo && (
            <>
              <span style={{ color: "#3d444d", margin: "0 2px" }}>·</span>
              <span style={{ color: "#6e7681", fontFamily: "monospace", fontSize: 11 }}>{repo.split("/")[1]}</span>
            </>
          )}
        </div>

        {/* Search shortcut hint */}
        {connected && (
          <button
            onClick={() => setShowSearch(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "3px 10px", borderRadius: 6, fontSize: 11.5,
              fontFamily: "'Inter', sans-serif", cursor: "pointer",
              border: "1px solid #21262d", background: "transparent",
              color: "#6e7681", transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#30363d")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#21262d")}
            title="Rechercher un fichier"
          >
            <span>🔍</span>
            <span>Fichiers</span>
            <kbd style={{ background: "#21262d", border: "1px solid #30363d", borderRadius: 4, padding: "1px 5px", fontSize: 10, marginLeft: 4 }}>
              ⌘K
            </kbd>
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Push to GitHub button */}
        {connected && currentPath && (
          <button
            onClick={handlePush}
            disabled={!canPush}
            title={canPush ? `Pousser ${currentPath} sur GitHub` : "Aucune modification à pousser"}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 12px", borderRadius: 6, fontSize: 12,
              fontFamily: "'Inter', sans-serif", fontWeight: 500,
              cursor: canPush ? "pointer" : "not-allowed",
              border: "1px solid",
              transition: "all 0.15s",
              borderColor: canPush ? "#238636" : "#21262d",
              background: canPush ? "#238636" : "transparent",
              color: canPush ? "#ffffff" : "#6e7681",
            }}
          >
            {editorHandle?.isSaving
              ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
              : <Upload style={{ width: 12, height: 12 }} />}
            Push ↑
          </button>
        )}
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div style={{ width: 220, background: "#010409", borderRight: "1px solid #21262d", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <Sidebar
            connected={connected}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            repo={repo}
            currentPath={currentPath}
            onSelectFile={handleSelectFile}
            isConnecting={configureMutation.isPending}
            onNotify={showBanner}
            refreshKey={agentRefreshKey}
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
                        marginLeft: 2, color: "#6e7681",
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
              ref={editorRef}
              currentPath={currentPath}
              connected={connected}
              appliedCode={appliedCode}
              onApplied={() => setAppliedCode(null)}
            />
          </div>
        </div>

        {/* Agent chat panel */}
        <div style={{ width: 320, borderLeft: "1px solid #21262d", display: "flex", flexDirection: "column", flexShrink: 0, background: "#010409" }}>
          <ChatPanel
            currentPath={currentPath}
            repo={repo}
            onApplyCode={setAppliedCode}
            onAgentCommit={() => setAgentRefreshKey((k) => k + 1)}
          />
        </div>
      </div>
    </div>
  );
}
