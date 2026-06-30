import React, { useEffect, useState, useRef } from "react";
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

export function Editor({ currentPath, connected, appliedCode, onApplied }: EditorProps) {
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: fileData, isLoading } = useReadGithubFile(
    { path: currentPath || "" },
    { query: { enabled: !!currentPath && connected, queryKey: getReadGithubFileQueryKey({ path: currentPath || "" }) } }
  );

  const writeMutation = useWriteGithubFile();
  const initRef = useRef<string | null>(null);

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

  const handleSave = () => {
    if (!currentPath || !fileData?.sha) return;

    writeMutation.mutate(
      {
        data: {
          path: currentPath,
          content,
          sha: fileData.sha,
          message: `Update ${currentPath} via Agent IDE`
        }
      },
      {
        onSuccess: () => {
          setIsDirty(false);
          toast({ title: "Saved successfully", description: currentPath });
          queryClient.invalidateQueries({ queryKey: getReadGithubFileQueryKey({ path: currentPath }) });
        },
        onError: () => {
          toast({ title: "Failed to save", variant: "destructive" });
        }
      }
    );
  };

  if (!connected) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
        <Code className="w-12 h-12 mb-4 opacity-20" />
        <p>Connect to a repository to begin.</p>
      </div>
    );
  }

  if (!currentPath) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Select a file from the sidebar to view and edit.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading {currentPath}...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="h-10 border-b border-border bg-muted/10 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center text-sm">
          <span className="text-muted-foreground font-mono mr-2">{currentPath}</span>
          {isDirty && <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>}
        </div>

        <Button
          size="sm"
          variant={isDirty ? "default" : "secondary"}
          className="h-7 text-xs"
          disabled={!isDirty || writeMutation.isPending}
          onClick={handleSave}
          data-testid="button-save-file"
        >
          {writeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Save className="w-3 h-3 mr-2" />}
          Save to GitHub
        </Button>
      </div>

      <div className="flex-1 p-0 relative overflow-hidden bg-[#0d1117]">
        <textarea
          className="absolute inset-0 w-full h-full p-4 bg-transparent text-foreground font-mono text-sm leading-relaxed resize-none focus:outline-none"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setIsDirty(true);
          }}
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
  );
}
