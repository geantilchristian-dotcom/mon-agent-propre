import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, FileCode, X } from "lucide-react";

interface FileSearchProps {
  onSelect: (path: string) => void;
  onClose: () => void;
}

function getFileIcon(name: string): { icon: string; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, { icon: string; color: string }> = {
    tsx: { icon: "⚛", color: "#61AFEF" }, jsx: { icon: "⚛", color: "#61AFEF" },
    ts:  { icon: "TS", color: "#3178C6" }, js:  { icon: "JS", color: "#F7DF1E" },
    json: { icon: "{}", color: "#98C379" }, css: { icon: "✦", color: "#C678DD" },
    scss: { icon: "✦", color: "#C678DD" }, html: { icon: "<>", color: "#E06C75" },
    md:  { icon: "M↓", color: "#ABB2BF" }, yaml: { icon: "≡", color: "#E5C07B" },
    yml: { icon: "≡", color: "#E5C07B" },  env:  { icon: "⚙", color: "#98C379" },
    sh:  { icon: "$", color: "#3FB950" },   py:   { icon: "Py", color: "#3572A5" },
  };
  return map[ext] ?? { icon: "·", color: "#6e7681" };
}

function scoreMatch(path: string, query: string): number {
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  if (p === q) return 100;
  const filename = path.split("/").pop()?.toLowerCase() ?? "";
  if (filename === q) return 90;
  if (filename.startsWith(q)) return 80;
  if (p.includes("/" + q)) return 70;
  if (filename.includes(q)) return 60;
  if (p.includes(q)) return 40;
  // fuzzy: all chars in order
  let qi = 0;
  for (let i = 0; i < p.length && qi < q.length; i++) {
    if (p[i] === q[qi]) qi++;
  }
  return qi === q.length ? 20 : 0;
}

export function FileSearch({ onSelect, onClose }: FileSearchProps) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    fetch("/api/github/tree")
      .then((r) => r.json())
      .then((d: { files?: string[] }) => {
        setFiles(d.files ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = query.trim()
    ? files
        .map((f) => ({ f, score: scoreMatch(f, query.trim()) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
        .map((x) => x.f)
    : files.slice(0, 50);

  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && filtered[activeIdx]) { onSelect(filtered[activeIdx]!); onClose(); }
  }, [filtered, activeIdx, onSelect, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function highlight(path: string, query: string): React.ReactNode {
    if (!query.trim()) return path;
    const filename = path.split("/").pop() ?? path;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const q = query.toLowerCase();
    const idx = filename.toLowerCase().indexOf(q);
    if (idx >= 0) {
      return (
        <>
          <span style={{ color: "#6e7681" }}>{dir}</span>
          {filename.slice(0, idx)}
          <span style={{ color: "#e5c07b", fontWeight: 600 }}>{filename.slice(idx, idx + q.length)}</span>
          {filename.slice(idx + q.length)}
        </>
      );
    }
    return <><span style={{ color: "#6e7681" }}>{dir}</span>{filename}</>;
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "10vh",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: 560, maxHeight: "70vh",
          background: "#161b22", border: "1px solid #30363d",
          borderRadius: 10, overflow: "hidden",
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
        }}
      >
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #21262d", gap: 10 }}>
          <Search style={{ width: 16, height: 16, color: "#6e7681", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher un fichier…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 13.5,
              color: "#c9d1d9",
            }}
            spellCheck={false}
          />
          <kbd
            onClick={onClose}
            style={{
              fontFamily: "sans-serif", fontSize: 11, color: "#6e7681",
              background: "#21262d", border: "1px solid #30363d",
              borderRadius: 4, padding: "2px 6px", cursor: "pointer",
            }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ padding: "16px 14px", color: "#6e7681", fontFamily: "sans-serif", fontSize: 12 }}>
              Chargement de l'arbre de fichiers…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "16px 14px", color: "#6e7681", fontFamily: "sans-serif", fontSize: 12 }}>
              Aucun fichier trouvé pour « {query} »
            </div>
          ) : (
            filtered.map((f, i) => {
              const fname = f.split("/").pop() ?? f;
              const { icon, color } = getFileIcon(fname);
              const isActive = i === activeIdx;
              return (
                <div
                  key={f}
                  onClick={() => { onSelect(f); onClose(); }}
                  onMouseEnter={() => setActiveIdx(i)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "6px 14px", cursor: "pointer",
                    background: isActive ? "rgba(97,175,239,0.1)" : "transparent",
                    borderLeft: isActive ? "2px solid #61afef" : "2px solid transparent",
                  }}
                >
                  <span style={{ color, fontSize: 11, fontFamily: "sans-serif", minWidth: 18, textAlign: "center", flexShrink: 0 }}>
                    {icon}
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#c9d1d9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {highlight(f, query)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid #21262d", padding: "6px 14px", display: "flex", gap: 14, alignItems: "center" }}>
          {[["↑↓", "naviguer"], ["↵", "ouvrir"], ["esc", "fermer"]].map(([k, l]) => (
            <span key={k} style={{ fontFamily: "sans-serif", fontSize: 10.5, color: "#6e7681", display: "flex", gap: 4, alignItems: "center" }}>
              <kbd style={{ background: "#21262d", border: "1px solid #30363d", borderRadius: 3, padding: "1px 5px", fontSize: 10 }}>{k}</kbd>
              {l}
            </span>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: "sans-serif", fontSize: 10, color: "#6e7681" }}>
            {filtered.length} fichier{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
