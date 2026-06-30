import React, { useState, useEffect, useRef } from "react";
import { Sidebar, saveRecentProject } from "@/components/Sidebar";
import { Editor, EditorHandle } from "@/components/Editor";
import { ChatPanel } from "@/components/ChatPanel";
import { FileSearch } from "@/components/FileSearch";
import { useConfigureGithub } from "@workspace/api-client-react";
import {
  GitBranch, Upload, Loader2, X, FileCode, Bot,
  FolderOpen, Code2, MessageSquare, Search,
} from "lucide-react";

const STORAGE_KEY = "agent-ide-github-config";

/* ------------------------------------------------------------------ */
/*  Mobile detection hook                                               */
/* ------------------------------------------------------------------ */

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

/* ------------------------------------------------------------------ */
/*  File icon helper                                                    */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Welcome screen                                                      */
/* ------------------------------------------------------------------ */

function WelcomeScreen({ repo, onSearch, isMobile }: {
  repo: string; onSearch: () => void; isMobile: boolean;
}) {
  const repoName = repo.split("/")[1] ?? repo;
  const tips = [
    { icon: "⌘K", label: "Recherche rapide de fichiers" },
    { icon: "@", label: "Mentionner un fichier dans le chat" },
    { icon: "⇧↵", label: "Saut de ligne dans l'agent" },
    { icon: "⌘S", label: "Pousser le fichier sur GitHub" },
  ];

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center text-center px-6"
      style={{ background: "#0d1117", color: "#8b949e" }}
    >
      <div
        className="flex items-center justify-center mb-5 rounded-2xl"
        style={{ width: 56, height: 56, background: "#161b22", border: "1px solid #21262d" }}
      >
        <FileCode className="w-7 h-7" style={{ color: "#3d444d" }} />
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 600, color: "#c9d1d9", marginBottom: 6, fontFamily: "'Inter', sans-serif" }}>
        {repo ? repoName : "Aucun projet ouvert"}
      </h2>
      <p style={{ fontSize: 12.5, color: "#6e7681", marginBottom: 24, lineHeight: 1.6, fontFamily: "'Inter', sans-serif" }}>
        {repo
          ? "Sélectionnez un fichier dans l'explorateur\npour commencer à éditer."
          : "Connectez un dépôt GitHub dans\nles fichiers pour commencer."}
      </p>

      {repo && (
        <button
          onClick={onSearch}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: isMobile ? "10px 20px" : "7px 14px",
            borderRadius: 8, fontSize: 13,
            fontFamily: "'Inter', sans-serif", cursor: "pointer",
            border: "1px solid #30363d", background: "#161b22",
            color: "#c9d1d9", transition: "border-color 0.15s",
            marginBottom: 28,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#58a6ff")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#30363d")}
        >
          <span>🔍 Rechercher un fichier</span>
          {!isMobile && (
            <kbd style={{ background: "#21262d", border: "1px solid #30363d", borderRadius: 4, padding: "1px 6px", fontSize: 10.5 }}>
              ⌘K
            </kbd>
          )}
        </button>
      )}

      {/* Keyboard shortcuts — desktop only */}
      {repo && !isMobile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 240 }}>
          <span style={{ fontSize: 10, color: "#3d444d", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, fontFamily: "'Inter', sans-serif", marginBottom: 2 }}>
            Raccourcis
          </span>
          {tips.map(({ icon, label }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11.5, color: "#6e7681", fontFamily: "'Inter', sans-serif" }}>{label}</span>
              <kbd style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 4, padding: "1px 6px", fontSize: 10.5, color: "#8b949e", fontFamily: "'JetBrains Mono', monospace" }}>
                {icon}
              </kbd>
            </div>
          ))}
        </div>
      )}

      {/* Agent tip */}
      {repo && (
        <div
          style={{
            marginTop: 20, padding: "10px 14px", borderRadius: 8,
            background: "rgba(63,185,80,0.06)", border: "1px solid rgba(63,185,80,0.15)",
            maxWidth: 280, width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Bot style={{ width: 12, height: 12, color: "#3fb950" }} />
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "#3fb950", fontFamily: "'Inter', sans-serif" }}>
              Agent IA actif
            </span>
          </div>
          <p style={{ fontSize: 11, color: "#6e7681", lineHeight: 1.5, fontFamily: "'Inter', sans-serif", margin: 0 }}>
            {isMobile
              ? "Ouvrez l'onglet Chat et demandez à l'agent de modifier vos fichiers."
              : "Demandez \"ajoute une page de contact\" et l'agent modifie directement vos fichiers GitHub."}
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Home                                                                */
/* ------------------------------------------------------------------ */

type MobileTab = "files" | "editor" | "chat";

export function Home() {
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<MobileTab>("files");

  const [connected, setConnected] = useState(false);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
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

  const fetchBranch = async () => {
    try {
      const r = await fetch("/api/github/repo-info");
      if (r.ok) {
        const d = await r.json() as { defaultBranch?: string };
        if (d.defaultBranch) setBranch(d.defaultBranch);
      }
    } catch { /* keep "main" */ }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const { token, repo: savedRepo } = JSON.parse(saved) as { token: string; repo: string };
        if (token && savedRepo) {
          configureMutation.mutate(
            { data: { token, repo: savedRepo } },
            {
              onSuccess: () => {
                setConnected(true);
                setRepo(savedRepo);
                fetchBranch();
              }
            }
          );
        }
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          fetchBranch();
          if (isMobile) setMobileTab("editor");
        },
        onError: () => showBanner("Échec de connexion GitHub", false),
      }
    );
  };

  const handleDisconnect = () => {
    setConnected(false);
    setRepo("");
    setBranch("main");
    setCurrentPath(null);
    setOpenTabs([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };

  const handleSelectFile = (path: string) => {
    setCurrentPath(path);
    setOpenTabs(prev => prev.includes(path) ? prev : [...prev, path]);
    if (isMobile) setMobileTab("editor");
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

  /* ---- shared panels ---- */
  const sidebarPanel = (
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
  );

  const editorPanel = (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ height: "100%" }}>
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
                  style={{ marginLeft: 2, color: "#6e7681", display: "flex", alignItems: "center" }}
                >
                  <X style={{ width: 12, height: 12 }} />
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        {currentPath ? (
          <Editor
            ref={editorRef}
            currentPath={currentPath}
            connected={connected}
            appliedCode={appliedCode}
            onApplied={() => setAppliedCode(null)}
          />
        ) : (
          <WelcomeScreen repo={repo} onSearch={() => setShowSearch(true)} isMobile={isMobile} />
        )}
      </div>
    </div>
  );

  const chatPanel = (
    <ChatPanel
      currentPath={currentPath}
      repo={repo}
      onApplyCode={(code) => {
        setAppliedCode(code);
        if (isMobile) setMobileTab("editor");
      }}
      onAgentCommit={() => setAgentRefreshKey((k) => k + 1)}
    />
  );

  /* ------------------------------------------------------------------ */
  /*  Render                                                              */
  /* ------------------------------------------------------------------ */

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
          whiteSpace: "nowrap",
        }}>
          {banner.text}
        </div>
      )}

      {/* File search overlay */}
      {showSearch && connected && (
        <FileSearch
          onSelect={(p) => { handleSelectFile(p); setShowSearch(false); }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* ---- TOP TOOLBAR ---- */}
      <div
        className="flex items-center shrink-0"
        style={{
          height: isMobile ? 48 : 40,
          padding: isMobile ? "0 12px" : "0 12px",
          gap: isMobile ? 8 : 12,
          background: "#010409",
          borderBottom: "1px solid #21262d",
        }}
      >
        {/* macOS dots — desktop only */}
        {!isMobile && (
          <>
            <div className="flex items-center gap-1.5">
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
            </div>
            <div style={{ width: 1, height: 20, background: "#21262d" }} />
          </>
        )}

        {/* Branch + repo badge */}
        <div
          className="flex items-center gap-1.5 text-xs"
          style={{
            color: "#8b949e", background: "#161b22",
            padding: isMobile ? "4px 10px" : "3px 10px",
            borderRadius: 6, border: "1px solid #30363d",
            fontSize: isMobile ? 12 : undefined,
          }}
        >
          <GitBranch style={{ width: 11, height: 11, color: "#3fb950" }} />
          <span style={{ color: "#3fb950" }}>{branch}</span>
          {repo && (
            <>
              <span style={{ color: "#3d444d", margin: "0 2px" }}>·</span>
              <span style={{ color: "#6e7681", fontFamily: "monospace", fontSize: 11 }}>
                {isMobile ? (repo.split("/")[1] ?? repo).slice(0, 14) : repo.split("/")[1]}
              </span>
            </>
          )}
        </div>

        {/* Search button — desktop */}
        {connected && !isMobile && (
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
          >
            <span>🔍</span>
            <span>Fichiers</span>
            <kbd style={{ background: "#21262d", border: "1px solid #30363d", borderRadius: 4, padding: "1px 5px", fontSize: 10, marginLeft: 4 }}>⌘K</kbd>
          </button>
        )}

        {/* Search icon — mobile */}
        {connected && isMobile && (
          <button
            onClick={() => setShowSearch(true)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 8, border: "1px solid #21262d",
              background: "transparent", cursor: "pointer", color: "#6e7681",
            }}
            title="Rechercher"
          >
            <Search style={{ width: 15, height: 15 }} />
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Push button */}
        {connected && currentPath && (
          <button
            onClick={handlePush}
            disabled={!canPush}
            title={canPush ? `Pousser sur GitHub` : "Aucune modification"}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: isMobile ? "8px 14px" : "4px 12px",
              borderRadius: 6, fontSize: isMobile ? 13 : 12,
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
              ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
              : <Upload style={{ width: 13, height: 13 }} />}
            {!isMobile && "Push ↑"}
          </button>
        )}
      </div>

      {/* ---- MAIN BODY ---- */}
      {isMobile ? (
        /* ---------- MOBILE: single panel at a time ---------- */
        <div className="flex-1 overflow-hidden flex flex-col">
          {mobileTab === "files" && (
            <div className="flex-1 overflow-hidden flex flex-col" style={{ background: "#010409" }}>
              {sidebarPanel}
            </div>
          )}
          {mobileTab === "editor" && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {editorPanel}
            </div>
          )}
          {mobileTab === "chat" && (
            <div className="flex-1 overflow-hidden flex flex-col" style={{ background: "#010409" }}>
              {chatPanel}
            </div>
          )}

          {/* Bottom tab bar */}
          <div
            style={{
              display: "flex", alignItems: "stretch",
              height: 56, background: "#010409",
              borderTop: "1px solid #21262d",
              flexShrink: 0,
            }}
          >
            {(
              [
                { id: "files",  Icon: FolderOpen,     label: "Fichiers" },
                { id: "editor", Icon: Code2,           label: "Éditeur" },
                { id: "chat",   Icon: MessageSquare,   label: "Agent" },
              ] as const
            ).map(({ id, Icon, label }) => {
              const active = mobileTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setMobileTab(id)}
                  style={{
                    flex: 1, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 3,
                    background: "transparent", cursor: "pointer",
                    border: "none",
                    borderTop: active ? "2px solid #61afef" : "2px solid transparent",
                    color: active ? "#61afef" : "#6e7681",
                    transition: "color 0.15s, border-color 0.15s",
                  }}
                >
                  <Icon style={{ width: 18, height: 18 }} />
                  <span style={{ fontSize: 10, fontFamily: "'Inter', sans-serif", fontWeight: active ? 600 : 400 }}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* ---------- DESKTOP: 3-column layout ---------- */
        <div className="flex flex-1 overflow-hidden">
          <div style={{ width: 220, background: "#010409", borderRight: "1px solid #21262d", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            {sidebarPanel}
          </div>

          {editorPanel}

          <div style={{ width: 320, borderLeft: "1px solid #21262d", display: "flex", flexDirection: "column", flexShrink: 0, background: "#010409" }}>
            {chatPanel}
          </div>
        </div>
      )}
    </div>
  );
}
