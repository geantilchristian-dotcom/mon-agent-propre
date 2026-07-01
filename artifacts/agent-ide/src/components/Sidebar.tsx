import React, { useState, useEffect } from "react";
import {
  useListGithubFiles, getListGithubFilesQueryKey,
  useWriteGithubFile, useDeleteGithubFile,
  getReadGithubFileQueryKey, readGithubFile,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ChevronRight, ChevronDown, Github, Plus, Trash2, LogOut, History } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

interface SidebarProps {
  connected: boolean;
  onConnect: (token: string, repo: string) => void;
  onDisconnect: () => void;
  repo: string;
  currentPath: string | null;
  onSelectFile: (path: string) => void;
  isConnecting: boolean;
  onNotify?: (text: string, ok: boolean) => void;
  refreshKey?: number;
  /** Callback déclenché lorsqu’on clique sur le bouton “Historique” */
  onShowHistory?: () => void;
}

/* ------------------------------------------------------------------ */
/*  File icon helpers                                                   */
/* ------------------------------------------------------------------ */

function getFileIcon(name: string, isDir = false): { label: string; color: string } {
  if (isDir) return { label: "▶", color: "#E5C07B" };
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, { label: string; color: string }> = {
    tsx:  { label: "⚛", color: "#61AFEF" },
    jsx:  { label: "⚛", color: "#61AFEF" },
    ts:   { label: "TS", color: "#3178C6" },
    js:   { label: "JS", color: "#F7DF1E" },
    json: { label: "{}", color: "#98C379" },
    css:  { label: "✦", color: "#C678DD" },
    scss: { label: "✦", color: "#C678DD" },
    html: { label: "<>", color: "#E06C75" },
    md:   { label: "M↓", color: "#ABB2BF" },
    yaml: { label: "≡",  color: "#E5C07B" },
    yml:  { label: "≡",  color: "#E5C07B" },
    env:  { label: "⚙",  color: "#98C379" },
    sh:   { label: "$",  color: "#3FB950" },
    py:   { label: "Py", color: "#3572A5" },
    svg:  { label: "◉",  color: "#E06C75" },
    png:  { label: "◉",  color: "#56B6C2" },
    jpg:  { label: "◉",  color: "#56B6C2" },
  };
  return map[ext] ?? { label: "·", color: "#6e7681" };
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                             */
/* ------------------------------------------------------------------ */

export function Sidebar({ connected, onConnect, onDisconnect, repo, currentPath, onSelectFile, isConnecting, onNotify, refreshKey }: SidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const queryClient = useQueryClient();
  const writeMutation = useWriteGithubFile();
  const notify = onNotify ?? (() => {});

  /* Refresh file tree when agent commits files */
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      queryClient.invalidateQueries({ queryKey: getListGithubFilesQueryKey() });
    }
  }, [refreshKey, queryClient]);

  const handleCreateFile = () => {
    if (!newFilePath.trim()) return;
    writeMutation.mutate(
      { data: { path: newFilePath, content: "", message: `Create ${newFilePath}` } },
      {
        onSuccess: () => {
          setIsCreating(false);
          setNewFilePath("");
          notify("Fichier créé ✓", true);
          queryClient.invalidateQueries({ queryKey: getListGithubFilesQueryKey() });
          onSelectFile(newFilePath);
        },
        onError: () => notify("Échec de création du fichier", false),
      }
    );
  };

  if (!connected) {
    return <ConnectionForm onConnect={onConnect} isConnecting={isConnecting} />;
  }

  const repoShort = repo.split("/")[1] ?? repo;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#010409" }}>
      {/* Connected repo banner */}
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid #21262d",
          background: "#0d1117",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <Github style={{ width: 11, height: 11, color: "#3fb950", flexShrink: 0 }} />
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#c9d1d9", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={repo}>
            {repoShort}
          </span>
        </div>
        <button
          onClick={onDisconnect}
          className="flex items-center gap-1.5 rounded transition-colors w-full"
          style={{
            padding: "4px 8px",
            fontSize: 11,
            color: "#8b949e",
            background: "#161b22",
            border: "1px solid #30363d",
            cursor: "pointer",
            justifyContent: "center",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#58a6ff";
            e.currentTarget.style.color = "#58a6ff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#30363d";
            e.currentTarget.style.color = "#8b949e";
          }}
        >
          <LogOut style={{ width: 11, height: 11 }} />
          Changer de dépôt
        </button>
      </div>

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{ height: 32, borderBottom: "1px solid #21262d" }}
      >
        <span
          className="uppercase tracking-wider font-semibold"
          style={{ fontSize: 10.5, color: "#6e7681", fontFamily: "sans-serif" }}
        >
          Explorateur
        </span>
        <button
          onClick={() => setIsCreating(!isCreating)}
          title="Nouveau fichier"
          className="flex items-center justify-center rounded hover:bg-white/5 transition-colors"
          style={{ width: 22, height: 22, color: "#8b949e" }}
        >
          <Plus style={{ width: 13, height: 13 }} />
        </button>
      </div>

      {/* New file input */}
      {isCreating && (
        <div style={{ padding: "6px 8px", borderBottom: "1px solid #21262d", background: "#0d1117" }}>
          <div className="flex gap-1.5">
            <Input
              autoFocus
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFile();
                if (e.key === "Escape") setIsCreating(false);
              }}
              placeholder="src/pages/Login.tsx"
              className="h-6 text-xs font-mono"
              style={{ fontSize: 11.5 }}
            />
            <Button
              size="sm" className="h-6 px-2 text-xs"
              onClick={handleCreateFile}
              disabled={writeMutation.isPending || !newFilePath.trim()}
            >
              {writeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "+"}
            </Button>
          </div>
        </div>
      )}

      {/* File tree */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "4px 0" }}>
        <FileTree path="" onSelectFile={onSelectFile} currentPath={currentPath} onNotify={notify} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Connection form                                                     */
/* ------------------------------------------------------------------ */

const PROJECTS_KEY = "agent-ide-projects";

interface RecentProject { repo: string; token: string; lastUsed: number; }

function getRecentProjects(): RecentProject[] {
  try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]") as RecentProject[]; }
  catch { return []; }
}

export function saveRecentProject(repo: string, token: string) {
  const list = getRecentProjects().filter((p) => p.repo !== repo);
  list.unshift({ repo, token, lastUsed: Date.now() });
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(list.slice(0, 6))); } catch { /* ignore */ }
}

function parseRepo(value: string): string {
  // Accept full GitHub URLs like https://github.com/owner/repo or just owner/repo
  const trimmed = value.trim().replace(/\.git$/, "");
  const match = trimmed.match(/github\.com\/([^/]+\/[^/]+)/);
  if (match) return match[1] ?? trimmed;
  return trimmed;
}

function ConnectionForm({ onConnect, isConnecting }: { onConnect: (t: string, r: string) => void; isConnecting: boolean }) {
  const [ghToken, setGhToken] = useState("");
  const [repo, setRepo] = useState("");
  const recent = getRecentProjects();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedRepo = parseRepo(repo);
    if (ghToken && parsedRepo) onConnect(ghToken, parsedRepo);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: "#010409" }}>
      {/* Recent projects */}
      {recent.length > 0 && (
        <div style={{ padding: "12px 12px 0" }}>
          <p style={{ fontFamily: "sans-serif", fontSize: 10, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, marginBottom: 6 }}>
            Projets récents
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 12 }}>
            {recent.map((p) => (
              <button
                key={p.repo}
                onClick={() => onConnect(p.token, p.repo)}
                disabled={isConnecting}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 8px", borderRadius: 6, cursor: "pointer",
                  background: "#0d1117", border: "1px solid #21262d",
                  textAlign: "left", width: "100%",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#30363d")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#21262d")}
              >
                <Github style={{ width: 11, height: 11, color: "#3fb950", flexShrink: 0 }} />
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#c9d1d9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.repo}
                </span>
              </button>
            ))}
          </div>
          <div style={{ borderTop: "1px solid #21262d", marginBottom: 12 }} />
        </div>
      )}

      <div className="p-4 flex flex-col justify-center" style={{ flex: recent.length > 0 ? "unset" : 1 }}>
        {recent.length === 0 && (
          <>
            <div className="mb-5 flex justify-center">
              <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "#161b22", border: "1px solid #30363d" }}>
                <Github className="w-5 h-5" style={{ color: "#8b949e" }} />
              </div>
            </div>
            <h2 className="text-sm font-semibold mb-1 text-center" style={{ color: "#c9d1d9" }}>Connecter un dépôt</h2>
            <p className="text-xs mb-5 text-center" style={{ color: "#6e7681" }}>Entrez vos identifiants GitHub.</p>
          </>
        )}

        {recent.length > 0 && (
          <p style={{ fontFamily: "sans-serif", fontSize: 10, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, marginBottom: 8 }}>
            Nouveau dépôt
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="token" className="text-xs" style={{ color: "#8b949e" }}>Personal Access Token</Label>
            <Input
              id="token" type="password" value={ghToken}
              onChange={(e) => setGhToken(e.target.value)}
              placeholder="ghp_..."
              className="h-7 text-xs font-mono"
              autoComplete="off" data-lpignore="true" data-1p-ignore
              data-testid="input-github-token"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="repo" className="text-xs" style={{ color: "#8b949e" }}>Dépôt GitHub</Label>
            <Input
              id="repo" value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo ou https://github.com/owner/repo"
              className="h-7 text-xs font-mono"
              autoComplete="off"
              data-testid="input-github-repo"
            />
          </div>
          <Button type="submit" className="w-full h-7 text-xs" disabled={!ghToken || !repo || isConnecting} data-testid="button-connect-github">
            {isConnecting ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
            Connecter
          </Button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  File tree                                                           */
/* ------------------------------------------------------------------ */

function FileTree({
  path, onSelectFile, currentPath, onNotify,
}: {
  path: string;
  onSelectFile: (path: string) => void;
  currentPath: string | null;
  onNotify: (text: string, ok: boolean) => void;
}) {
  const { data: files, isLoading } = useListGithubFiles(
    { path },
    { query: { enabled: true, queryKey: getListGithubFilesQueryKey({ path }) } }
  );

  if (isLoading) {
    return (
      <div className="py-1 px-4 text-xs flex items-center" style={{ color: "#6e7681" }}>
        <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Chargement…
      </div>
    );
  }

  if (!files || files.length === 0) {
    return <div className="py-1 px-4 text-xs italic" style={{ color: "#6e7681" }}>Vide</div>;
  }

  const sorted = [...files].sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === "dir" ? -1 : 1;
  });

  return (
    <div>
      {sorted.map((file) => (
        <FileNode key={file.path} file={file} onSelectFile={onSelectFile} currentPath={currentPath} onNotify={onNotify} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  File node                                                           */
/* ------------------------------------------------------------------ */

function FileNode({
  file, onSelectFile, currentPath, onNotify,
}: {
  file: { name: string; path: string; type: string; size?: number | null };
  onSelectFile: (path: string) => void;
  currentPath: string | null;
  onNotify: (text: string, ok: boolean) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isSelected = currentPath === file.path;
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteGithubFile();
  const isDir = file.type === "dir";
  const { label, color } = getFileIcon(file.name, isDir);
  const depth = file.path.split("/").length - 1;

  const handleClick = () => {
    if (isDir) setIsOpen(!isOpen);
    else onSelectFile(file.path);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Supprimer ${file.path} ?`)) return;
    setIsDeleting(true);
    try {
      let sha: string | undefined;
      const cached = queryClient.getQueryData<{ sha?: string | null }>(getReadGithubFileQueryKey({ path: file.path }));
      sha = cached?.sha ?? undefined;

      if (!sha) {
        const fileData = await queryClient.fetchQuery({
          queryKey: getReadGithubFileQueryKey({ path: file.path }),
          queryFn: () => readGithubFile({ path: file.path }),
        });
        sha = fileData.sha ?? undefined;
      }
      if (!sha) throw new Error("SHA introuvable");

      deleteMutation.mutate(
        { data: { path: file.path, sha, message: `Delete ${file.path}` } },
        {
          onSuccess: () => {
            onNotify("Fichier supprimé ✓", true);
            queryClient.invalidateQueries({ queryKey: getListGithubFilesQueryKey() });
            if (currentPath === file.path) onSelectFile("");
          },
          onError: () => onNotify("Échec de suppression", false),
        }
      );
    } catch {
      onNotify("Impossible de lire le SHA du fichier", false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        className="group flex items-center justify-between cursor-pointer select-none"
        style={{
          paddingLeft: 8 + depth * 12,
          paddingRight: 6,
          paddingTop: 2,
          paddingBottom: 2,
          fontSize: 12.5,
          color: isSelected ? "#c9d1d9" : "#8b949e",
          background: isSelected ? "rgba(97,175,239,0.12)" : "transparent",
          borderLeft: isSelected ? "2px solid #61afef" : "2px solid transparent",
          fontFamily: "'JetBrains Mono', monospace",
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = "transparent";
        }}
        data-testid={`file-node-${file.path.replace(/\//g, "-")}`}
      >
        <div className="flex items-center gap-1.5 overflow-hidden min-w-0">
          {isDir ? (
            <span style={{ color: "#E5C07B", fontSize: 9, flexShrink: 0 }}>
              {isOpen ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
            </span>
          ) : (
            <span style={{ color, fontSize: 10, flexShrink: 0, fontFamily: "sans-serif", minWidth: 16, textAlign: "center" }}>
              {label}
            </span>
          )}
          <span className="truncate">{file.name}</span>
        </div>

        {!isDir && (
          <button
            className="opacity-0 group-hover:opacity-100 flex items-center justify-center rounded transition-all shrink-0"
            style={{ width: 18, height: 18, color: "#6e7681" }}
            onClick={handleDelete}
            disabled={isDeleting || deleteMutation.isPending}
            title="Supprimer"
            onMouseEnter={(e) => { e.currentTarget.style.color = "#f85149"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#6e7681"; }}
          >
            {isDeleting || deleteMutation.isPending
              ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />
              : <Trash2 style={{ width: 10, height: 10 }} />}
          </button>
        )}
      </div>

      {isDir && isOpen && (
        <div>
          <FileTree path={file.path} onSelectFile={onSelectFile} currentPath={currentPath} onNotify={onNotify} />
        </div>
      )}
    </div>
  );
}
