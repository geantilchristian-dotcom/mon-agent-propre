import React, { useEffect, useState, useRef, useCallback } from "react";
import { useReadGithubFile, getReadGithubFileQueryKey, useWriteGithubFile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Code } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface EditorProps {
  currentPath: string | null;
  connected: boolean;
  appliedCode?: string | null;
  onApplied?: () => void;
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

export function Editor({ currentPath, connected, appliedCode, onApplied }: EditorProps) {
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lnRef = useRef<HTMLDivElement>(null);
  const initRef = useRef<string | null>(null);

  const { data: fileData, isLoading } = useReadGithubFile(
    { path: currentPath || "" },
    { query: { enabled: !!currentPath && connected, queryKey: getReadGithubFileQueryKey({ path: currentPath || "" }) } }
  );

  const writeMutation = useWriteGithubFile();

  useEffect(() => {
    if (fileData?.content !== undefined && initRef.current !== currentPath) {
      setContent(fileData.content || "");
      setIsDirty(false);
      initRef.current = currentPath;
    }
  }, [fileData, currentPath]);

  useEffect(() => {
    if (appliedCode !== undefined && appliedCode !== null) {
      setContent(appliedCode);
      setIsDirty(true);
      if (onApplied) onApplied();
    }
  }, [appliedCode, onApplied]);

  const syncScroll = useCallback(() => {
    if (lnRef.current && taRef.current) {
      lnRef.current.scrollTop = taRef.current.scrollTop;
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

  const handleSave = () => {
    if (!currentPath || !fileData?.sha) return;
    writeMutation.mutate(
      { data: { path: currentPath, content, sha: fileData.sha, message: `Update ${currentPath} via Agent IDE` } },
      {
        onSuccess: () => {
          setIsDirty(false);
          toast({ title: "Sauvegardé", description: currentPath });
          queryClient.invalidateQueries({ queryKey: getReadGithubFileQueryKey({ path: currentPath }) });
        },
        onError: () => toast({ title: "Échec de sauvegarde", variant: "destructive" }),
      }
    );
  };

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Editor toolbar */}
      <div className="h-9 border-b border-border bg-[#010409] flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground/60">
          {isDirty && <span className="w-2 h-2 rounded-full bg-primary shrink-0" title="Non sauvegardé" />}
        </div>
        <Button
          size="sm"
          variant={isDirty ? "default" : "ghost"}
          className="h-6 text-[11px] px-2.5"
          disabled={!isDirty || writeMutation.isPending}
          onClick={handleSave}
          data-testid="button-save-file"
        >
          {writeMutation.isPending
            ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
            : <Save className="w-3 h-3 mr-1.5" />}
          Save
        </Button>
      </div>

      {/* Code area */}
      <div className="flex-1 overflow-hidden flex bg-[#0d1117]">
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
            <div
              key={i}
              style={{ color: i + 1 === cursorLine ? "#8b949e" : "#3d444d" }}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={taRef}
          className="flex-1 font-mono text-[13px] leading-[22px] resize-none focus:outline-none bg-transparent text-foreground pt-3 pb-3 pr-4 pl-4"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setIsDirty(true);
          }}
          onScroll={syncScroll}
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
        {isDirty && <span className="text-yellow-400">● Non sauvegardé</span>}
      </div>
    </div>
  );
}
