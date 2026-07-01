import React, { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import hljs from "highlight.js";
import { useReadGithubFile, getReadGithubFileQueryKey, useWriteGithubFile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Code } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface EditorHandle {
  save: () => void;
  isDirty: boolean;
  isSaving: boolean;
}

interface EditorProps {
  currentPath: string | null;
  connected: boolean;
  appliedCode?: string | null;
  onApplied?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}

function getLanguageLabel(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", jsx: "JavaScript React",
    css: "CSS", scss: "SCSS", html: "HTML", json: "JSON", md: "Markdown",
    yaml: "YAML", yml: "YAML", py: "Python", sh: "Shell", env: "Env",
  };
  return map[ext] ?? ext.toUpperCase();
}

function getHljsLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    css: "css", scss: "scss", html: "html", json: "json", md: "markdown",
    yaml: "yaml", yml: "yaml", py: "python", sh: "bash", env: "bash",
  };
  return map[ext] ?? "plaintext";
}

function highlight(code: string, lang: string): string {
  try {
    const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
    return result.value;
  } catch {
    return hljs.highlightAuto(code).value;
  }
}

const PAIR: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
const OPEN_PAIRS = new Set(["(", "[", "{"]);

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { currentPath, connected, appliedCode, onApplied, onDirtyChange, onSavingChange },
  ref
) {
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const lnRef = useRef<HTMLDivElement>(null);
  const initRef = useRef<string | null>(null);

  const { data: fileData, isLoading } = useReadGithubFile(
    { path: currentPath || "" },
    { query: { enabled: !!currentPath && connected, queryKey: getReadGithubFileQueryKey({ path: currentPath || "" }) } }
  );

  const writeMutation = useWriteGithubFile();

  const markDirty = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
    onDirtyChange?.(dirty);
  }, [onDirtyChange]);

  useEffect(() => {
    onSavingChange?.(writeMutation.isPending);
  }, [writeMutation.isPending, onSavingChange]);

  useEffect(() => {
    if (fileData?.content !== undefined && initRef.current !== currentPath) {
      setContent(fileData.content || "");
      markDirty(false);
      initRef.current = currentPath;
    }
  }, [fileData, currentPath, markDirty]);

  useEffect(() => {
    if (appliedCode !== undefined && appliedCode !== null) {
      setContent(appliedCode);
      markDirty(true);
      if (onApplied) onApplied();
    }
  }, [appliedCode, onApplied, markDirty]);

  const syncScroll = useCallback(() => {
    if (lnRef.current && taRef.current) lnRef.current.scrollTop = taRef.current.scrollTop;
    if (hlRef.current && taRef.current) {
      hlRef.current.scrollTop = taRef.current.scrollTop;
      hlRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }, []);

  const updateCursor = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const lines = before.split("\n");
    setCursorLine(lines.length);
    setCursorCol((lines[lines.length - 1]?.length ?? 0) + 1);
  }, []);

  const handleSave = useCallback(() => {
    if (!currentPath || !fileData?.sha || writeMutation.isPending) return;
    writeMutation.mutate(
      { data: { path: currentPath, content, sha: fileData.sha, message: `Update ${currentPath} via Agent IDE` } },
      {
        onSuccess: () => {
          markDirty(false);
          toast({ title: "Poussé sur GitHub ✓", description: currentPath });
          queryClient.invalidateQueries({ queryKey: getReadGithubFileQueryKey({ path: currentPath }) });
        },
        onError: () => toast({ title: "Échec du push", variant: "destructive" }),
      }
    );
  }, [currentPath, content, fileData?.sha, writeMutation, queryClient, toast, markDirty]);

  useImperativeHandle(ref, () => ({
    save: handleSave,
    get isDirty() { return isDirty; },
    get isSaving() { return writeMutation.isPending; },
  }), [handleSave, isDirty, writeMutation.isPending]);

  /* ---- Tab key + auto-close brackets ---- */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    if (e.key === "Tab") {
      e.preventDefault();
      const indent = "  ";
      const newVal = content.slice(0, start) + indent + content.slice(end);
      setContent(newVal);
      markDirty(true);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + indent.length;
      });
      return;
    }

    const closing = PAIR[e.key];
    if (closing && start === end) {
      if (OPEN_PAIRS.has(e.key)) {
        e.preventDefault();
        const newVal = content.slice(0, start) + e.key + closing + content.slice(end);
        setContent(newVal);
        markDirty(true);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1; });
        return;
      }
      /* closing quotes — if next char already is the closing char, just skip over it */
      if (!OPEN_PAIRS.has(e.key)) {
        const nextChar = content[start];
        if (nextChar === e.key) {
          e.preventDefault();
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1; });
          return;
        }
        /* wrap with quote pair */
        e.preventDefault();
        const newVal = content.slice(0, start) + e.key + closing + content.slice(end);
        setContent(newVal);
        markDirty(true);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1; });
        return;
      }
    }

    /* Backspace removes both chars of a pair */
    if (e.key === "Backspace" && start === end && start > 0) {
      const prev = content[start - 1];
      const next = content[start];
      if (prev && PAIR[prev] === next) {
        e.preventDefault();
        const newVal = content.slice(0, start - 1) + content.slice(start + 1);
        setContent(newVal);
        markDirty(true);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start - 1; });
      }
    }
  }, [content, markDirty]);

  if (!connected) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
        <Code className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-sm">Connectez un dépôt GitHub pour commencer.</p>
      </div>
    );
  }

  if (!currentPath) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Sélectionnez un fichier dans l'explorateur.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…
      </div>
    );
  }

  const lines = content.split("\n");
  const lang = getHljsLang(currentPath);
  const highlightedHtml = highlight(content + "\n", lang);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-hidden flex" style={{ background: "#0d1117" }}>

        {/* Line numbers */}
        <div
          ref={lnRef}
          className="select-none overflow-hidden shrink-0 text-right font-mono text-[12.5px] leading-[22px] pt-3 pb-3 pr-3 pl-3"
          style={{
            width: `${Math.max(String(lines.length).length * 9 + 20, 42)}px`,
            color: "#3d444d",
            borderRight: "1px solid #21262d",
            overflowY: "hidden",
          }}
        >
          {lines.map((_, i) => (
            <div key={i} style={{ color: i + 1 === cursorLine ? "#8b949e" : "#3d444d" }}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code area — highlighted div + transparent textarea stacked */}
        <div className="flex-1 relative overflow-auto" style={{ background: "#0d1117" }}>
          {/* Syntax-highlighted layer (read-only, behind) */}
          <div
            ref={hlRef}
            className="hljs absolute inset-0 font-mono text-[13px] leading-[22px] whitespace-pre pt-3 pb-3 pr-4 pl-4 pointer-events-none overflow-hidden"
            style={{ background: "transparent", color: "#c9d1d9", tabSize: 2 }}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            aria-hidden
          />
          {/* Transparent editable textarea on top */}
          <textarea
            ref={taRef}
            className="absolute inset-0 w-full h-full font-mono text-[13px] leading-[22px] resize-none focus:outline-none pt-3 pb-3 pr-4 pl-4"
            style={{ background: "transparent", color: "transparent", caretColor: "#c9d1d9", tabSize: 2, zIndex: 1 }}
            value={content}
            onChange={(e) => { setContent(e.target.value); markDirty(true); }}
            onScroll={syncScroll}
            onKeyDown={handleKeyDown}
            onKeyUp={updateCursor}
            onClick={updateCursor}
            onSelect={updateCursor}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            data-testid="editor-textarea"
          />
        </div>
      </div>

      {/* Status bar */}
      <div
        className="h-6 shrink-0 flex items-center px-3 gap-5 text-[11px] border-t border-border/60"
        style={{ background: "#161b22", color: "#8b949e" }}
      >
        <span className="text-[#3fb950] font-medium">⎇ main</span>
        <span>{getLanguageLabel(currentPath)}</span>
        <span>Ln {cursorLine}, Col {cursorCol}</span>
        <div className="flex-1" />
        <span>{lines.length} lignes</span>
        {isDirty && <span style={{ color: "#e5c07b" }}>● Non sauvegardé</span>}
      </div>
    </div>
  );
});
