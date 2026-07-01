import React, { useState, useEffect, useRef } from "react";
import { Sidebar, saveRecentProject } from "@/components/Sidebar";
import { Editor, EditorHandle } from "@/components/Editor";
import { ChatPanel } from "@/components/ChatPanel";
import { FileSearch } from "@/components/FileSearch";
import { useConfigureGithub } from "@workspace/api-client-react";
import {
  GitBranch, Upload, Loader2, X, FileCode, Bot,
  FolderOpen, Code2, MessageSquare, Search, Monitor,
  RefreshCw, ExternalLink, Globe,
} from "lucide-react";

const STORAGE_KEY = "agent-ide-github-config";
const getPreviewKey = (repo: string) => `agent-ide-preview-${repo.replace("/", "-")}`;

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
/*  Preview panel                                                       */
/* ------------------------------------------------------------------ */

/** Returns true if a URL is likely to block iframe embedding (major public sites). */
function isLikelyBlocked(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    // Hosts known to block iframes
    const blockedPatterns = [
      /github\.com$/, /google\.com$/, /youtube\.com$/, /facebook\.com$/,
      /twitter\.com$/, /x\.com$/, /instagram\.com$/, /linkedin\.com$/,
      /wikipedia\.org$/, /reddit\.com$/, /amazon\.com$/, /apple\.com$/,
      /microsoft\.com$/, /stackoverflow\.com$/,
    ];
    if (blockedPatterns.some((p) => p.test(h))) return true;
    // Allow dev/hosting platforms that usually permit iframes
    const allowed = ["onrender.com", "netlify.app", "vercel.app", "replit.dev",
      "replit.app", "github.io", "pages.dev", "localhost", "127.0.0.1"];
    if (allowed.some((a) => h.endsWith(a))) return false;
    // Generic .com/.net/.org/.fr etc on a root domain → likely blocks
    const parts = h.split(".");
    if (parts.length <= 2) return true;
    return false;
  } catch { return false; }
}

function PreviewPanel({ previewUrl, onUrlChange, agentRefreshKey }: { previewUrl: string; onUrlChange: (url: string) => void; agentRefreshKey?: number }) {
  const [editUrl, setEditUrl] = useState(previewUrl);
  const [liveUrl, setLiveUrl] = useState(previewUrl);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [deployCountdown, setDeployCountdown] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh preview after agent commits (with deploy countdown)
  useEffect(() => {
    if (!agentRefreshKey || !liveUrl) return;
    // Immediate reload for local/fast hosts; countdown for Render/Netlify
    const isSlowHost = /onrender\.com|netlify\.app|vercel\.app/.test(liveUrl);
    const delay = isSlowHost ? 90 : 5;
    setDeployCountdown(delay);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setDeployCountdown((c) => {
        if (c === null || c <= 1) {
          clearInterval(countdownRef.current!);
          // Reload the iframe
          if (iframeRef.current) {
            setLoading(true);
            setBlocked(false);
            iframeRef.current.src = liveUrl + (liveUrl.includes("?") ? "&" : "?") + "_t=" + Date.now();
          }
          return null;
        }
        return c - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRefreshKey]);

  const navigate = (url: string) => {
    let u = url.trim();
    if (u && !u.startsWith("http")) u = "https://" + u;
    setLiveUrl(u);
    onUrlChange(u);
    setEditUrl(u);
    setLoading(true);
    setBlocked(false);
    // Schedule block detection after 3s
    if (blockTimerRef.current) clearTimeout(blockTimerRef.current);
    if (isLikelyBlocked(u)) {
      blockTimerRef.current = setTimeout(() => setBlocked(true), 3000);
    }
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); navigate(editUrl); };

  const handleRefresh = () => {
    if (iframeRef.current && liveUrl) {
      setLoading(true);
      setBlocked(false);
      iframeRef.current.src = liveUrl;
      if (isLikelyBlocked(liveUrl)) {
        if (blockTimerRef.current) clearTimeout(blockTimerRef.current);
        blockTimerRef.current = setTimeout(() => setBlocked(true), 3000);
      }
    }
  };

  const handleIframeLoad = () => {
    setLoading(false);
    // Try to detect blank/blocked content (cross-origin will throw, same-origin empty = blocked)
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc && doc.body && doc.body.innerHTML.trim() === "") setBlocked(true);
    } catch { /* cross-origin — can't inspect, rely on timer */ }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#0d1117" }}>
      {/* URL bar */}
      <div
        className="flex items-center gap-2 shrink-0 px-2"
        style={{ height: 36, borderBottom: "1px solid #21262d", background: "#010409" }}
      >
        <Globe style={{ width: 13, height: 13, color: "#6e7681", flexShrink: 0 }} />

        <form onSubmit={handleSubmit} style={{ flex: 1, display: "flex" }}>
          <input
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            placeholder="https://votre-app.onrender.com"
            style={{
              flex: 1, background: "#161b22", border: "1px solid #21262d",
              borderRadius: 5, padding: "3px 8px", fontSize: 11.5,
              fontFamily: "'JetBrains Mono', monospace", color: "#c9d1d9",
              outline: "none",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#388bfd")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#21262d")}
          />
        </form>

        <button
          onClick={handleRefresh}
          disabled={!liveUrl}
          title="Actualiser"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 26, height: 26, borderRadius: 5, border: "1px solid #21262d",
            background: "transparent", cursor: liveUrl ? "pointer" : "not-allowed",
            color: liveUrl ? "#8b949e" : "#3d444d",
          }}
        >
          <RefreshCw style={{ width: 12, height: 12 }} className={loading ? "animate-spin" : ""} />
        </button>

        {liveUrl && (
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Ouvrir dans un nouvel onglet"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, borderRadius: 5, border: "1px solid #21262d",
              background: "transparent", color: "#8b949e", textDecoration: "none",
            }}
          >
            <ExternalLink style={{ width: 12, height: 12 }} />
          </a>
        )}
      </div>

      {/* Deploy countdown banner */}
      {deployCountdown !== null && (
        <div style={{
          padding: "6px 12px", background: "#161b22", borderBottom: "1px solid #21262d",
          display: "flex", alignItems: "center", gap: 8, fontSize: 12,
        }}>
          <RefreshCw style={{ width: 12, height: 12, color: "#58a6ff", flexShrink: 0 }} className="animate-spin" />
          <span style={{ color: "#8b949e" }}>
            Agent a modifié des fichiers — rechargement de l'aperçu dans
            <strong style={{ color: "#c9d1d9", marginLeft: 4 }}>{deployCountdown}s</strong>
          </span>
          <button
            onClick={() => {
              if (countdownRef.current) clearInterval(countdownRef.current);
              setDeployCountdown(null);
              if (iframeRef.current && liveUrl) { setLoading(true); iframeRef.current.src = liveUrl; }
            }}
            style={{ marginLeft: "auto", fontSize: 11, color: "#58a6ff", background: "none", border: "none", cursor: "pointer" }}
          >
            Recharger maintenant
          </button>
        </div>
      )}

      {/* Blocked overlay */}
      {blocked && liveUrl && (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center"
          style={{ background: "#0d1117" }}
        >
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: "#161b22", border: "1px solid #30363d",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <ExternalLink style={{ width: 24, height: 24, color: "#388bfd" }} />
          </div>
          <div>
            <p style={{ color: "#c9d1d9", fontSize: 14, fontWeight: 600, margin: 0 }}>
              Ce site bloque l'aperçu intégré
            </p>
            <p style={{ color: "#6e7681", fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
              La plupart des sites .com, .net, .org et autres domaines publics<br />
              refusent d'être affichés dans un cadre intégré (iframe) pour des raisons<br />
              de sécurité. C'est une limitation du navigateur, pas de l'agent.
            </p>
          </div>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: "#238636", color: "#ffffff", textDecoration: "none",
              border: "1px solid #2ea043",
            }}
          >
            <ExternalLink style={{ width: 13, height: 13 }} />
            Ouvrir {new URL(liveUrl).hostname} dans un onglet
          </a>
          <button
            onClick={() => setBlocked(false)}
            style={{ fontSize: 11, color: "#6e7681", background: "none", border: "none", cursor: "pointer" }}
          >
            Essayer quand même d'afficher
          </button>
        </div>
      )}

      {/* Iframe or empty state */}
      {!blocked && liveUrl ? (
        <iframe
          ref={iframeRef}
          src={liveUrl}
          title="Aperçu de l'application"
          onLoad={handleIframeLoad}
          style={{ flex: 1, border: "none", background: "#ffffff" }}
          allow="clipboard-read; clipboard-write"
        />
      ) : !blocked && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <div
            style={{
              width: 48, height: 48, borderRadius: 12,
              background: "#161b22", border: "1px solid #21262d",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Monitor style={{ width: 22, height: 22, color: "#3d444d" }} />
          </div>
          <p style={{ fontSize: 12.5, color: "#6e7681", lineHeight: 1.6, fontFamily: "'Inter', sans-serif", maxWidth: 260 }}>
            Entrez l'URL de votre application dans la barre ci-dessus pour l'aperçu en direct.
          </p>
          <p style={{ fontSize: 11, color: "#3d444d", fontFamily: "'JetBrains Mono', monospace" }}>
            ex: https://mon-app.onrender.com
          </p>
        </div>
      )}
    </div>
  );
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

type MobileTab = "files" | "editor" | "chat" | "preview";

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
  const [previewUrl, setPreviewUrl] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const handlePreviewUrlChange = (url: string) => {
    setPreviewUrl(url);
    if (repo) {
      try { localStorage.setItem(getPreviewKey(repo), url); } catch { /* ignore */ }
    }
  };

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
                loadPreviewForRepo(savedRepo);
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

  const loadPreviewForRepo = (repoName: string) => {
    try {
      const savedUrl = localStorage.getItem(getPreviewKey(repoName)) ?? "";
      setPreviewUrl(savedUrl);
      if (savedUrl) setShowPreview(true);
    } catch { /* ignore */ }
  };

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
          loadPreviewForRepo(repoName);
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
    setPreviewUrl("");
    setShowPreview(false);
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

  const [editorIsDirty, setEditorIsDirty] = useState(false);
  const [editorIsSaving, setEditorIsSaving] = useState(false);

  const handlePush = () => editorRef.current?.save();
  const canPush = connected && !!currentPath && editorIsDirty && !editorIsSaving;

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
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ height: "100%", willChange: "auto" }}>
      {/* Tab bar — file tabs + preview tab */}
      <div
        className="flex items-stretch shrink-0 overflow-x-auto"
        style={{ height: 36, background: "#010409", borderBottom: "1px solid #21262d" }}
      >
        {openTabs.map(tab => {
          const name = tab.split("/").pop() ?? tab;
          const { icon, color } = getFileIcon(name);
          const isActive = !showPreview && currentPath === tab;
          return (
            <button
              key={tab}
              onClick={() => { setCurrentPath(tab); setShowPreview(false); }}
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

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Preview tab */}
        <button
          onClick={() => setShowPreview(v => !v)}
          title="Aperçu de l'application"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "0 14px", borderLeft: "1px solid #21262d",
            fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
            color: showPreview ? "#3fb950" : "#6e7681",
            background: showPreview ? "#0d1117" : "transparent",
            borderBottom: showPreview ? "2px solid #3fb950" : "none",
            fontFamily: "'Inter', sans-serif", flexShrink: 0,
          }}
        >
          <Monitor style={{ width: 13, height: 13 }} />
          <span>Aperçu</span>
          {previewUrl && (
            <span style={{
              marginLeft: 4, fontSize: 10, background: "#1a4a2e",
              color: "#3fb950", border: "1px solid #1f6a3a",
              borderRadius: 4, padding: "0px 5px",
            }}>
              Live
            </span>
          )}
        </button>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {showPreview ? (
          <PreviewPanel previewUrl={previewUrl} onUrlChange={handlePreviewUrlChange} agentRefreshKey={agentRefreshKey} />
        ) : currentPath ? (
          <Editor
            ref={editorRef}
            currentPath={currentPath}
            connected={connected}
            appliedCode={appliedCode}
            onApplied={() => setAppliedCode(null)}
            onDirtyChange={setEditorIsDirty}
            onSavingChange={setEditorIsSaving}
            agentRefreshKey={agentRefreshKey}
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
        {/* Logo */}
        <img
          src="/logo.png"
          alt="Elianex Code"
          style={{ height: isMobile ? 28 : 26, width: "auto", objectFit: "contain", flexShrink: 0 }}
        />
        {!isMobile && (
          <div style={{ width: 1, height: 20, background: "#21262d" }} />
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

        {/* Push button — always visible when connected */}
        {connected && (
          <button
            onClick={handlePush}
            disabled={!canPush}
            title={canPush ? "Pousser les modifications sur GitHub" : !currentPath ? "Ouvrez un fichier pour modifier et pousser" : "Aucune modification en attente"}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: isMobile ? "8px 14px" : "4px 12px",
              borderRadius: 6, fontSize: isMobile ? 13 : 12,
              fontFamily: "'Inter', sans-serif", fontWeight: 500,
              cursor: canPush ? "pointer" : "default",
              border: "1px solid",
              transition: "all 0.15s",
              borderColor: canPush ? "#238636" : "#30363d",
              background: canPush ? "#238636" : "transparent",
              color: canPush ? "#ffffff" : "#484f58",
            }}
          >
            {editorIsSaving
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
          {mobileTab === "preview" && (
            <div className="flex-1 overflow-hidden flex flex-col" style={{ background: "#0d1117" }}>
              <PreviewPanel previewUrl={previewUrl} onUrlChange={handlePreviewUrlChange} agentRefreshKey={agentRefreshKey} />
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
                { id: "files",   Icon: FolderOpen,   label: "Fichiers" },
                { id: "editor",  Icon: Code2,         label: "Éditeur" },
                { id: "preview", Icon: Monitor,       label: "Aperçu" },
                { id: "chat",    Icon: MessageSquare, label: "Agent" },
              ] as const
            ).map(({ id, Icon, label }) => {
              const active = mobileTab === id;
              const isPreview = id === "preview";
              return (
                <button
                  key={id}
                  onClick={() => setMobileTab(id)}
                  style={{
                    flex: 1, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 3,
                    background: "transparent", cursor: "pointer",
                    border: "none",
                    borderTop: active
                      ? `2px solid ${isPreview ? "#3fb950" : "#61afef"}`
                      : "2px solid transparent",
                    color: active
                      ? (isPreview ? "#3fb950" : "#61afef")
                      : "#6e7681",
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
