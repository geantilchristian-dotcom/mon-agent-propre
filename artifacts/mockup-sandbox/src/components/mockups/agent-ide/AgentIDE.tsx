export function AgentIDE() {
  const files = [
    { name: "src", type: "folder", depth: 0, open: true },
    { name: "components", type: "folder", depth: 1, open: true },
    { name: "App.tsx", type: "tsx", depth: 2 },
    { name: "Sidebar.tsx", type: "tsx", depth: 2, active: true },
    { name: "Editor.tsx", type: "tsx", depth: 2 },
    { name: "ChatPanel.tsx", type: "tsx", depth: 2 },
    { name: "pages", type: "folder", depth: 1, open: true },
    { name: "Home.tsx", type: "tsx", depth: 2 },
    { name: "Login.tsx", type: "tsx", depth: 2, new: true },
    { name: "styles", type: "folder", depth: 1, open: false },
    { name: "public", type: "folder", depth: 0, open: false },
    { name: "package.json", type: "json", depth: 0 },
    { name: "vite.config.ts", type: "ts", depth: 0 },
  ];

  const tabs = [
    { name: "Sidebar.tsx", type: "tsx", active: true },
    { name: "Home.tsx", type: "tsx" },
    { name: "Login.tsx", type: "tsx", new: true },
  ];

  const codeLines = [
    { n: 1,  t: "" },
    { n: 2,  t: `<span class="kw">import</span> <span class="bracket">{</span> useState <span class="bracket">}</span> <span class="kw">from</span> <span class="str">'react'</span>` },
    { n: 3,  t: `<span class="kw">import</span> <span class="bracket">{</span> FileIcon, FolderIcon <span class="bracket">}</span> <span class="kw">from</span> <span class="str">'lucide-react'</span>` },
    { n: 4,  t: "" },
    { n: 5,  t: `<span class="kw">interface</span> <span class="type">SidebarProps</span> <span class="bracket">{</span>` },
    { n: 6,  t: `&nbsp;&nbsp;files<span class="punct">:</span> <span class="type">FileEntry</span><span class="bracket">[]</span>` },
    { n: 7,  t: `&nbsp;&nbsp;onSelect<span class="punct">:</span> <span class="bracket">(</span>path<span class="punct">:</span> <span class="type">string</span><span class="bracket">)</span> <span class="punct">=&gt;</span> <span class="type">void</span>` },
    { n: 8,  t: `<span class="bracket">}</span>` },
    { n: 9,  t: "" },
    { n: 10, t: `<span class="kw">export function</span> <span class="fn">Sidebar</span><span class="bracket">(</span><span class="bracket">{</span> files<span class="punct">,</span> onSelect <span class="bracket">}</span><span class="punct">:</span> <span class="type">SidebarProps</span><span class="bracket">)</span> <span class="bracket">{</span>` },
    { n: 11, t: `&nbsp;&nbsp;<span class="kw">const</span> <span class="bracket">[</span>open<span class="punct">,</span> setOpen<span class="bracket">]</span> <span class="punct">=</span> <span class="fn">useState</span><span class="bracket">&lt;</span><span class="type">Set</span><span class="bracket">&lt;</span><span class="type">string</span><span class="bracket">&gt;&gt;</span><span class="bracket">(</span><span class="kw">new</span> <span class="type">Set</span><span class="bracket">())</span>` },
    { n: 12, t: "" },
    { n: 13, t: `&nbsp;&nbsp;<span class="kw">return</span> <span class="bracket">(</span>` },
    { n: 14, t: `&nbsp;&nbsp;&nbsp;&nbsp;<span class="tag">&lt;aside</span> <span class="attr">className</span><span class="punct">=</span><span class="str">"sidebar"</span><span class="tag">&gt;</span>` },
    { n: 15, t: `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="tag">&lt;div</span> <span class="attr">className</span><span class="punct">=</span><span class="str">"file-tree"</span><span class="tag">&gt;</span>` },
    { n: 16, t: `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="bracket">{</span>files<span class="punct">.</span><span class="fn">map</span><span class="bracket">((</span>file<span class="bracket">)</span> <span class="punct">=&gt;</span> <span class="bracket">(</span>` },
    { n: 17, t: `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="tag">&lt;FileRow</span> <span class="attr">key</span><span class="punct">=</span><span class="bracket">{</span>file<span class="punct">.</span>path<span class="bracket">}</span> <span class="attr">file</span><span class="punct">=</span><span class="bracket">{</span>file<span class="bracket">}</span> <span class="tag">/&gt;</span>` },
    { n: 18, t: `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="bracket">))}</span>` },
    { n: 19, t: `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="tag">&lt;/div&gt;</span>` },
    { n: 20, t: `&nbsp;&nbsp;&nbsp;&nbsp;<span class="tag">&lt;/aside&gt;</span>` },
    { n: 21, t: `&nbsp;&nbsp;<span class="bracket">)</span>` },
    { n: 22, t: `<span class="bracket">}</span>` },
  ];

  const extColor: Record<string, string> = {
    tsx: "#61AFEF",
    ts: "#C678DD",
    json: "#E5C07B",
    css: "#56B6C2",
    folder: "#E5C07B",
  };

  const extIcon: Record<string, string> = {
    tsx: "⚛",
    ts: "𝗧",
    json: "{}",
    css: "✦",
    folder: "▶",
  };

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: "#0d1117", height: "100vh", display: "flex", flexDirection: "column", color: "#c9d1d9", overflow: "hidden" }}>
      <style>{`
        .kw { color: #c678dd; }
        .str { color: #98c379; }
        .fn { color: #61afef; }
        .type { color: #e5c07b; }
        .attr { color: #d19a66; }
        .tag { color: #e06c75; }
        .punct { color: #abb2bf; }
        .bracket { color: #c678dd; }
        .comment { color: #5c6370; font-style: italic; }
        .line-row:hover { background: rgba(255,255,255,0.04); }
        .line-row.hl { background: rgba(97,175,239,0.08); }
        .tab-item { border-right: 1px solid #21262d; padding: 0 16px; height: 100%; display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer; white-space:nowrap; color:#8b949e; }
        .tab-item.active { color:#c9d1d9; background:#0d1117; border-bottom: 2px solid #61afef; }
        .tab-item:hover { background: rgba(255,255,255,0.04); }
        .file-row { display:flex; align-items:center; gap:6px; padding:2px 8px; cursor:pointer; border-radius:4px; font-size:12.5px; color:#8b949e; user-select:none; }
        .file-row:hover { background:rgba(255,255,255,0.06); color:#c9d1d9; }
        .file-row.active { background:rgba(97,175,239,0.15); color:#c9d1d9; }
        .agent-msg { background:#161b22; border-radius:8px; padding:10px 12px; margin:8px 0; font-size:12.5px; line-height:1.6; }
        .agent-msg.user { background:rgba(97,175,239,0.1); border-left:2px solid #61afef; }
        .agent-msg.ai { border-left:2px solid #3fb950; }
        .changed-file { display:flex; align-items:center; gap:6px; padding:4px 8px; background:#161b22; border-radius:4px; font-size:11.5px; margin:3px 0; }
      `}</style>

      {/* Top toolbar */}
      <div style={{ height: 40, background: "#010409", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", padding: "0 12px", gap: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <div style={{ width: 1, height: 20, background: "#21262d", margin: "0 8px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#161b22", padding: "4px 10px", borderRadius: 6, border: "1px solid #30363d" }}>
          <span style={{ color: "#3fb950", fontSize: 12 }}>⎇</span>
          <span style={{ fontSize: 12, color: "#8b949e" }}>mon-agent-propre</span>
          <span style={{ fontSize: 11, color: "#6e7681" }}>/ main</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ background: "#238636", padding: "4px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif" }}>▶ Run</div>
      </div>

      {/* File tabs */}
      <div style={{ height: 38, background: "#010409", borderBottom: "1px solid #21262d", display: "flex", alignItems: "stretch", flexShrink: 0, overflowX: "auto" }}>
        {tabs.map(tab => (
          <div key={tab.name} className={`tab-item${tab.active ? " active" : ""}`}>
            <span style={{ color: extColor[tab.type], fontSize: 11 }}>{extIcon[tab.type]}</span>
            <span>{tab.name}</span>
            {tab.new && <span style={{ fontSize: 10, background: "#3fb950", color: "#000", borderRadius: 3, padding: "1px 4px", fontFamily: "sans-serif" }}>NEW</span>}
            <span style={{ marginLeft: 4, color: "#6e7681", fontSize: 14 }}>×</span>
          </div>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Sidebar */}
        <div style={{ width: 220, background: "#010409", borderRight: "1px solid #21262d", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "8px 10px 4px", fontSize: 11, color: "#6e7681", fontWeight: 700, letterSpacing: "0.08em", fontFamily: "sans-serif", textTransform: "uppercase" }}>
            Explorateur
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "0 4px 8px" }}>
            {files.map((f, i) => (
              <div
                key={i}
                className={`file-row${f.active ? " active" : ""}`}
                style={{ paddingLeft: 8 + f.depth * 14 }}
              >
                {f.type === "folder" ? (
                  <span style={{ color: extColor.folder, fontSize: 10 }}>{f.open ? "▼" : "▶"}</span>
                ) : (
                  <span style={{ color: extColor[f.type] || "#8b949e", fontSize: 11 }}>{extIcon[f.type] || "•"}</span>
                )}
                <span style={{ fontFamily: "sans-serif" }}>{f.name}</span>
                {f.new && <span style={{ marginLeft: "auto", fontSize: 10, color: "#3fb950" }}>●</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div style={{ flex: 1, background: "#0d1117", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflow: "auto", display: "flex" }}>
            {/* Line numbers */}
            <div style={{ width: 48, background: "#0d1117", paddingTop: 16, textAlign: "right", paddingRight: 12, color: "#3d444d", fontSize: 13, lineHeight: "22px", userSelect: "none", flexShrink: 0, borderRight: "1px solid #21262d" }}>
              {codeLines.map(l => <div key={l.n}>{l.n}</div>)}
            </div>
            {/* Code */}
            <div style={{ flex: 1, padding: "16px 0", minWidth: 0 }}>
              {codeLines.map(l => (
                <div
                  key={l.n}
                  className={`line-row${l.n === 10 ? " hl" : ""}`}
                  style={{ height: 22, lineHeight: "22px", paddingLeft: 16, fontSize: 13, whiteSpace: "pre" }}
                  dangerouslySetInnerHTML={{ __html: l.t || " " }}
                />
              ))}
            </div>
          </div>
          {/* Status bar */}
          <div style={{ height: 24, background: "#1f2937", borderTop: "1px solid #21262d", display: "flex", alignItems: "center", padding: "0 12px", gap: 16, fontSize: 11, color: "#8b949e", flexShrink: 0, fontFamily: "sans-serif" }}>
            <span style={{ color: "#61afef" }}>⎇ main</span>
            <span>TypeScript React</span>
            <span>Ln 10, Col 22</span>
            <div style={{ flex: 1 }} />
            <span style={{ color: "#3fb950" }}>✓ 0 erreurs</span>
            <span>UTF-8</span>
          </div>
        </div>

        {/* Agent Panel */}
        <div style={{ width: 320, background: "#010409", borderLeft: "1px solid #21262d", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          {/* Panel header */}
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#3fb950", boxShadow: "0 0 6px #3fb950" }} />
            <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "sans-serif" }}>Agent IA</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "#6e7681", fontFamily: "sans-serif" }}>mon-agent-propre</span>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflow: "auto", padding: "12px 12px" }}>
            <div className="agent-msg user" style={{ fontFamily: "sans-serif" }}>
              Ajoute une page de connexion avec formulaire email/mot de passe
            </div>

            <div style={{ fontSize: 11, color: "#6e7681", fontFamily: "sans-serif", margin: "8px 0 4px", display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", background: "linear-gradient(135deg,#61afef,#3fb950)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>AI</div>
              Analyse du projet…
            </div>

            <div className="agent-msg ai" style={{ fontFamily: "sans-serif" }}>
              <div style={{ marginBottom: 8 }}>J'ai analysé votre projet. Il utilise React Router v6 avec 3 routes existantes. Je vais :</div>
              <div style={{ color: "#8b949e", fontSize: 12, marginBottom: 6 }}>
                <div>① Créer <span style={{ color: "#61afef" }}>src/pages/Login.tsx</span></div>
                <div>② Ajouter la route dans <span style={{ color: "#61afef" }}>App.tsx</span></div>
                <div>③ Mettre un lien dans <span style={{ color: "#61afef" }}>Sidebar.tsx</span></div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: "#3fb950", fontFamily: "sans-serif", margin: "8px 0 4px" }}>✓ Commit 3fa91b2 — 3 fichiers modifiés</div>
            <div className="changed-file"><span style={{ color: "#3fb950" }}>+</span><span style={{ color: "#61afef" }}>⚛</span><span style={{ fontFamily: "sans-serif" }}>src/pages/Login.tsx</span></div>
            <div className="changed-file"><span style={{ color: "#d19a66" }}>~</span><span style={{ color: "#61afef" }}>⚛</span><span style={{ fontFamily: "sans-serif" }}>src/App.tsx</span></div>
            <div className="changed-file"><span style={{ color: "#d19a66" }}>~</span><span style={{ color: "#61afef" }}>⚛</span><span style={{ fontFamily: "sans-serif" }}>src/components/Sidebar.tsx</span></div>

            <div style={{ fontSize: 11, color: "#6e7681", fontFamily: "sans-serif", marginTop: 8 }}>
              Render redéployera automatiquement depuis ce commit.
            </div>
          </div>

          {/* Input */}
          <div style={{ padding: "10px 12px", borderTop: "1px solid #21262d" }}>
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "flex-end", gap: 8 }}>
              <textarea
                readOnly
                placeholder="Décrivez ce que vous voulez faire…"
                value=""
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#c9d1d9", fontSize: 13, resize: "none", fontFamily: "sans-serif", height: 40 }}
              />
              <div style={{ width: 30, height: 30, borderRadius: 6, background: "#238636", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14 }}>↑</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
