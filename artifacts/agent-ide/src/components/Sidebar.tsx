import React, { useState } from "react";
import { useListGithubFiles, getListGithubFilesQueryKey, useWriteGithubFile, useDeleteGithubFile, getReadGithubFileQueryKey, readGithubFile } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, FileIcon, FolderIcon, ChevronRight, ChevronDown, Github, Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface SidebarProps {
  connected: boolean;
  onConnect: (token: string, repo: string) => void;
  currentPath: string | null;
  onSelectFile: (path: string) => void;
  isConnecting: boolean;
}

export function Sidebar({ connected, onConnect, currentPath, onSelectFile, isConnecting }: SidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const writeMutation = useWriteGithubFile();

  const handleCreateFile = () => {
    if (!newFilePath.trim()) return;
    
    writeMutation.mutate(
      { data: { path: newFilePath, content: "", message: `Create ${newFilePath}` } },
      {
        onSuccess: () => {
          setIsCreating(false);
          setNewFilePath("");
          toast({ title: "File created" });
          queryClient.invalidateQueries({ queryKey: getListGithubFilesQueryKey() });
          onSelectFile(newFilePath);
        },
        onError: () => {
          toast({ title: "Failed to create file", variant: "destructive" });
        }
      }
    );
  };

  if (!connected) {
    return <ConnectionForm onConnect={onConnect} isConnecting={isConnecting} />;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Explorer</h2>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsCreating(!isCreating)}>
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
      
      {isCreating && (
        <div className="p-2 bg-muted/20 border-b border-border">
          <div className="flex space-x-2">
            <Input 
              autoFocus
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFile();
                if (e.key === "Escape") setIsCreating(false);
              }}
              placeholder="e.g. src/utils.ts"
              className="h-7 text-xs"
            />
            <Button size="sm" className="h-7 px-2" onClick={handleCreateFile} disabled={writeMutation.isPending || !newFilePath.trim()}>
              {writeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        <FileTree path="" onSelectFile={onSelectFile} currentPath={currentPath} />
      </div>
    </div>
  );
}

function ConnectionForm({ onConnect, isConnecting }: { onConnect: (t: string, r: string) => void, isConnecting: boolean }) {
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (token && repo) {
      onConnect(token, repo);
    }
  };

  return (
    <div className="p-4 flex flex-col h-full justify-center">
      <div className="mb-6 flex justify-center">
        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
          <Github className="w-6 h-6 text-primary" />
        </div>
      </div>
      <h2 className="text-lg font-semibold mb-2 text-center">Connect Repository</h2>
      <p className="text-xs text-muted-foreground mb-6 text-center">Enter your GitHub credentials to begin.</p>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="token" className="text-xs">Personal Access Token</Label>
          <Input 
            id="token" 
            type="password" 
            value={token} 
            onChange={e => setToken(e.target.value)} 
            placeholder="ghp_..." 
            className="h-8 text-xs font-mono"
            data-testid="input-github-token"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repo" className="text-xs">Repository</Label>
          <Input 
            id="repo" 
            value={repo} 
            onChange={e => setRepo(e.target.value)} 
            placeholder="owner/repo" 
            className="h-8 text-xs font-mono"
            data-testid="input-github-repo"
          />
        </div>
        <Button 
          type="submit" 
          className="w-full h-8 text-xs" 
          disabled={!token || !repo || isConnecting}
          data-testid="button-connect-github"
        >
          {isConnecting ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : null}
          Connect
        </Button>
      </form>
    </div>
  );
}

function FileTree({ path, onSelectFile, currentPath }: { path: string, onSelectFile: (path: string) => void, currentPath: string | null }) {
  const { data: files, isLoading } = useListGithubFiles(
    { path },
    { query: { enabled: true, queryKey: getListGithubFilesQueryKey({ path }) } }
  );

  if (isLoading) {
    return <div className="pl-4 py-1 text-xs text-muted-foreground flex items-center"><Loader2 className="w-3 h-3 animate-spin mr-2" /> Loading...</div>;
  }

  if (!files || files.length === 0) {
    return <div className="pl-4 py-1 text-xs text-muted-foreground italic">Empty</div>;
  }

  // Sort: directories first, then files
  const sorted = [...files].sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === "dir" ? -1 : 1;
  });

  return (
    <div className="space-y-[1px]">
      {sorted.map(file => (
        <FileNode 
          key={file.path} 
          file={file} 
          onSelectFile={onSelectFile} 
          currentPath={currentPath}
        />
      ))}
    </div>
  );
}

function FileNode({ file, onSelectFile, currentPath }: { file: any, onSelectFile: (path: string) => void, currentPath: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isSelected = currentPath === file.path;
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteGithubFile();
  const { toast } = useToast();

  const handleClick = () => {
    if (file.type === "dir") {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(file.path);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete ${file.path}?`)) return;
    
    setIsDeleting(true);
    try {
      let sha = file.sha;
      if (!sha) {
        const fileData = await queryClient.fetchQuery({
          queryKey: getReadGithubFileQueryKey({ path: file.path }),
          queryFn: () => readGithubFile({ path: file.path })
        });
        sha = fileData.sha;
      }
      
      if (!sha) throw new Error("Could not get file sha");

      deleteMutation.mutate(
        { data: { path: file.path, sha, message: `Delete ${file.path}` } },
        {
          onSuccess: () => {
            toast({ title: "File deleted" });
            queryClient.invalidateQueries({ queryKey: getListGithubFilesQueryKey() });
            if (currentPath === file.path) {
              onSelectFile("");
            }
          },
          onError: () => {
            toast({ title: "Failed to delete file", variant: "destructive" });
          }
        }
      );
    } catch (err) {
      toast({ title: "Failed to read file for deletion", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div>
      <div 
        onClick={handleClick}
        className={`flex items-center justify-between py-1 px-2 rounded-sm cursor-pointer select-none group text-sm ${isSelected ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-foreground/80'}`}
        data-testid={`file-node-${file.path.replace(/\//g, '-')}`}
      >
        <div className="flex items-center overflow-hidden">
          <div className="w-4 h-4 mr-1.5 flex shrink-0 items-center justify-center text-muted-foreground">
            {file.type === "dir" ? (
              isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
            ) : (
              <FileIcon className={`w-3.5 h-3.5 ${isSelected ? 'text-primary' : ''}`} />
            )}
          </div>
          <span className="truncate">{file.name}</span>
        </div>
        
        {file.type !== "dir" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
            onClick={handleDelete}
            disabled={isDeleting || deleteMutation.isPending}
            title="Delete file"
          >
            {isDeleting || deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          </Button>
        )}
      </div>
      
      {file.type === "dir" && isOpen && (
        <div className="pl-4 border-l border-border/50 ml-3 mt-[1px]">
          <FileTree path={file.path} onSelectFile={onSelectFile} currentPath={currentPath} />
        </div>
      )}
    </div>
  );
}
