import { Router, type IRouter } from "express";
import { Octokit } from "octokit";
import { RunAgentBody } from "@workspace/api-zod";

const router: IRouter = Router();

/* ------------------------------------------------------------------ */
/*  Module-level shared state (same process as github.ts)              */
/* ------------------------------------------------------------------ */
let octokit: Octokit | null = null;
let currentOwner: string | null = null;
let currentRepo: string | null = null;

export function setAgentGithub(
  kit: Octokit,
  owner: string,
  repo: string
): void {
  octokit = kit;
  currentOwner = owner;
  currentRepo = repo;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Recursively collect file paths up to `maxFiles` entries. */
async function collectTree(
  kit: Octokit,
  owner: string,
  repo: string,
  path: string,
  acc: string[],
  maxFiles: number
): Promise<void> {
  if (acc.length >= maxFiles) return;
  try {
    const { data } = await kit.rest.repos.getContent({ owner, repo, path });
    if (!Array.isArray(data)) return;
    for (const item of data) {
      if (acc.length >= maxFiles) break;
      if (item.type === "file") acc.push(item.path);
      else if (item.type === "dir") {
        await collectTree(kit, owner, repo, item.path, acc, maxFiles);
      }
    }
  } catch { /* ignore permission errors on sub-dirs */ }
}

/** Read a single file and return its UTF-8 content + SHA. */
async function readFile(
  kit: Octokit,
  owner: string,
  repo: string,
  path: string
): Promise<{ content: string; sha: string } | null> {
  try {
    const { data } = await kit.rest.repos.getContent({ owner, repo, path });
    if (Array.isArray(data) || data.type !== "file") return null;
    const content = Buffer.from(
      (data as { content: string }).content.replace(/\n/g, ""),
      "base64"
    ).toString("utf8");
    return { content, sha: (data as { sha: string }).sha };
  } catch { return null; }
}

/** Get the HEAD commit SHA for the default branch. */
async function getHeadSha(
  kit: Octokit,
  owner: string,
  repo: string
): Promise<{ commitSha: string; treeSha: string }> {
  const { data: ref } = await kit.rest.git.getRef({
    owner,
    repo,
    ref: "heads/main",
  });
  const headSha = ref.object.sha;
  const { data: commit } = await kit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: headSha,
  });
  return { commitSha: headSha, treeSha: commit.tree.sha };
}

type TreeEntry = {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000" | "120000";
  type: "blob" | "tree" | "commit";
  sha?: string | null;
};

/** Create a single git commit with all writes + deletes. */
async function batchCommit(
  kit: Octokit,
  owner: string,
  repo: string,
  writes: { path: string; content: string }[],
  deletes: { path: string }[],
  message: string
): Promise<string> {
  const { commitSha, treeSha } = await getHeadSha(kit, owner, repo);

  const treeEntries: TreeEntry[] = [];

  // Create blobs for each written file
  for (const { path, content } of writes) {
    const { data: blob } = await kit.rest.git.createBlob({
      owner,
      repo,
      content: Buffer.from(content, "utf8").toString("base64"),
      encoding: "base64",
    });
    treeEntries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  // Mark deletes with sha: null
  for (const { path } of deletes) {
    treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
  }

  if (treeEntries.length === 0) throw new Error("No file changes to commit");

  const { data: newTree } = await kit.rest.git.createTree({
    owner,
    repo,
    base_tree: treeSha,
    tree: treeEntries,
  });

  const { data: newCommit } = await kit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.sha,
    parents: [commitSha],
  });

  await kit.rest.git.updateRef({
    owner,
    repo,
    ref: "heads/main",
    sha: newCommit.sha,
  });

  return newCommit.sha;
}

/* ------------------------------------------------------------------ */
/*  LLM helpers                                                         */
/* ------------------------------------------------------------------ */

type OAIMsg = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function callGroq(
  apiKey: string,
  messages: OAIMsg[]
): Promise<{ ok: true; text: string } | { ok: false; err: string }> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: 8192,
      temperature: 0.3,
    }),
  });
  if (!res.ok) return { ok: false, err: `Groq ${res.status}` };
  const d = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return { ok: true, text: d.choices[0]?.message?.content ?? "" };
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userMessage: string
): Promise<{ ok: true; text: string } | { ok: false; err: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.3 },
      }),
    }
  );
  if (!res.ok) return { ok: false, err: `Gemini ${res.status}` };
  const d = (await res.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  return {
    ok: true,
    text: d.candidates[0]?.content?.parts?.[0]?.text ?? "",
  };
}

async function callLLM(
  messages: OAIMsg[],
  groqKey?: string,
  geminiKey?: string
): Promise<{ text: string; model: string }> {
  if (groqKey) {
    const r = await callGroq(groqKey, messages);
    if (r.ok) return { text: r.text, model: "Groq · Llama 3.3 70B" };
  }
  if (geminiKey) {
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content)
      .join("\n\n");
    const r = await callGemini(geminiKey, sys, user);
    if (r.ok) return { text: r.text, model: "Gemini 2.0 Flash" };
    throw new Error(r.err);
  }
  throw new Error("No LLM API key configured.");
}

/* ------------------------------------------------------------------ */
/*  XML tag parsers                                                     */
/* ------------------------------------------------------------------ */

function parseReadRequests(text: string): string[] {
  const paths: string[] = [];
  const re = /<read_file\s+path="([^"]+)"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) paths.push(m[1]!);
  return [...new Set(paths)];
}

function parseWrites(text: string): { path: string; content: string }[] {
  const writes: { path: string; content: string }[] = [];
  const re = /<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    writes.push({ path: m[1]!, content: m[2]!.replace(/^\n/, "") });
  }
  return writes;
}

function parseDeletes(text: string): { path: string }[] {
  const deletes: { path: string }[] = [];
  const re = /<delete_file\s+path="([^"]+)"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) deletes.push({ path: m[1]! });
  return [...new Set(deletes.map((d) => d.path))].map((p) => ({ path: p }));
}

/** Strip tool tags from the final response shown to user. */
function cleanResponse(text: string): string {
  return text
    .replace(/<read_file\s+path="[^"]+"\s*\/>/g, "")
    .replace(/<write_file\s+path="[^"]+">([\s\S]*?)<\/write_file>/g, "")
    .replace(/<delete_file\s+path="[^"]+"\s*\/>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ */
/*  System prompt builder                                               */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(fileTree: string[]): string {
  return `Tu es un agent de codage autonome connecté à un dépôt GitHub. Tu peux lire, créer, modifier et supprimer des fichiers directement dans le dépôt.

## Structure du projet
${fileTree.map((f) => `  ${f}`).join("\n")}

## Outils disponibles

Pour lire un fichier :
<read_file path="chemin/relatif/fichier.ext" />

Pour créer ou modifier un fichier (contenu COMPLET, jamais partiel) :
<write_file path="chemin/relatif/fichier.ext">
CONTENU COMPLET DU FICHIER ICI
</write_file>

Pour supprimer un fichier :
<delete_file path="chemin/relatif/fichier.ext" />

## Règles ABSOLUES
1. Dans <write_file>, fournis TOUJOURS le contenu COMPLET du fichier — jamais de "..." ni de troncature
2. LIS d'abord les fichiers pertinents avant de faire des changements
3. Explique clairement ce que tu as changé et pourquoi (en français)
4. Fais des changements chirurgicaux — ne réécris pas les fichiers inutilement
5. Ne casse jamais ce qui fonctionne déjà
6. Si plusieurs fichiers sont liés, modifie-les tous de façon cohérente`;
}

/* ------------------------------------------------------------------ */
/*  Route                                                               */
/* ------------------------------------------------------------------ */

router.post("/agent/run", async (req, res) => {
  if (!octokit || !currentOwner || !currentRepo) {
    res.status(400).json({
      error: "Non configuré. Connectez d'abord un dépôt GitHub.",
    });
    return;
  }

  const parsed = RunAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Corps de requête invalide" });
    return;
  }

  const { message, currentFile } = parsed.data;
  const groqKey = process.env["GROQ_API_KEY"];
  const geminiKey = process.env["GEMINI_API_KEY"];

  if (!groqKey && !geminiKey) {
    res.status(500).json({
      error:
        "Aucune clé IA configurée. Ajoutez GROQ_API_KEY ou GEMINI_API_KEY.",
    });
    return;
  }

  try {
    const kit = octokit;
    const owner = currentOwner;
    const repo = currentRepo;

    /* --- 1. Collect file tree (max 200 files) --- */
    const fileTree: string[] = [];
    await collectTree(kit, owner, repo, "", fileTree, 200);

    const systemPrompt = buildSystemPrompt(fileTree);

    /* --- 2. Build initial user message --- */
    let userMsg = message;
    if (currentFile) {
      userMsg = `Fichier actuellement ouvert : ${currentFile}\n\n${message}`;
    }

    const messages: OAIMsg[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg },
    ];

    /* --- 3. First LLM call --- */
    req.log.info({ owner, repo, message }, "Agent: first LLM call");
    const turn1 = await callLLM(messages, groqKey, geminiKey);

    /* --- 4. Execute read_file requests --- */
    const readPaths = parseReadRequests(turn1.text);
    let turn2Text = turn1.text;
    let modelName = turn1.model;

    if (readPaths.length > 0) {
      req.log.info({ paths: readPaths }, "Agent: reading files");

      const fileContents: string[] = [];
      for (const p of readPaths.slice(0, 8)) {
        const f = await readFile(kit, owner, repo, p);
        if (f) {
          fileContents.push(
            `=== ${p} ===\n\`\`\`\n${f.content}\n\`\`\``
          );
        } else {
          fileContents.push(`=== ${p} ===\n(fichier non trouvé ou vide)`);
        }
      }

      messages.push({ role: "assistant", content: turn1.text });
      messages.push({
        role: "user",
        content: `Voici le contenu des fichiers demandés :\n\n${fileContents.join("\n\n")}\n\nMaintenant effectue les modifications nécessaires.`,
      });

      req.log.info("Agent: second LLM call");
      const turn2 = await callLLM(messages, groqKey, geminiKey);
      turn2Text = turn2.text;
      modelName = turn2.model;
    }

    /* --- 5. Parse file operations --- */
    const writes = parseWrites(turn2Text);
    const deletes = parseDeletes(turn2Text);
    const filesChanged: string[] = [
      ...writes.map((w) => w.path),
      ...deletes.map((d) => d.path),
    ];

    /* --- 6. Batch commit if there are changes --- */
    let commitSha: string | null = null;
    if (writes.length > 0 || deletes.length > 0) {
      req.log.info(
        { writes: writes.map((w) => w.path), deletes: deletes.map((d) => d.path) },
        "Agent: committing changes"
      );

      // Extract a commit message from the AI response (first non-empty line)
      const firstLine = cleanResponse(turn2Text).split("\n")[0]?.slice(0, 72) ?? message.slice(0, 72);
      const commitMsg = `feat(agent): ${firstLine}\n\n${filesChanged.map((f) => `- ${f}`).join("\n")}`;

      commitSha = await batchCommit(kit, owner, repo, writes, deletes, commitMsg);
      req.log.info({ commitSha }, "Agent: commit created");
    }

    /* --- 7. Return --- */
    res.json({
      response: cleanResponse(turn2Text),
      filesChanged,
      commitSha,
      model: modelName,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    req.log.error({ err: e }, "Agent error");
    res.status(500).json({ error: msg });
  }
});

export { router as agentRouter };
