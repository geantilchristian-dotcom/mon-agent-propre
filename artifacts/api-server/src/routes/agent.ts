import { Router, type IRouter } from "express";
import { Octokit } from "octokit";
import { RunAgentBody } from "@workspace/api-zod";

const router: IRouter = Router();

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
  } catch { /* ignore */ }
}

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

/** Truncate large file content to avoid blowing the context window. */
function truncateContent(content: string, maxChars = 6000): string {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2);
  const truncated = content.length - maxChars;
  return (
    content.slice(0, half) +
    `\n\n... [${truncated} caractères tronqués pour limiter les tokens] ...\n\n` +
    content.slice(-half)
  );
}

/** Compute simple line diff stats between old and new content. */
function diffStats(oldContent: string | null, newContent: string): { added: number; removed: number; isNew: boolean } {
  if (!oldContent) return { added: newContent.split("\n").length, removed: 0, isNew: true };
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const added = newLines.filter(l => !oldSet.has(l)).length;
  const removed = oldLines.filter(l => !newSet.has(l)).length;
  return { added, removed, isNew: false };
}

async function getHeadSha(
  kit: Octokit,
  owner: string,
  repo: string
): Promise<{ commitSha: string; treeSha: string }> {
  const { data: ref } = await kit.rest.git.getRef({ owner, repo, ref: "heads/main" });
  const headSha = ref.object.sha;
  const { data: commit } = await kit.rest.git.getCommit({ owner, repo, commit_sha: headSha });
  return { commitSha: headSha, treeSha: commit.tree.sha };
}

type TreeEntry = {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000" | "120000";
  type: "blob" | "tree" | "commit";
  sha?: string | null;
};

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

  for (const { path, content } of writes) {
    const { data: blob } = await kit.rest.git.createBlob({
      owner, repo,
      content: Buffer.from(content, "utf8").toString("base64"),
      encoding: "base64",
    });
    treeEntries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  for (const { path } of deletes) {
    treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
  }

  if (treeEntries.length === 0) throw new Error("Aucun changement à committer");

  const { data: newTree } = await kit.rest.git.createTree({
    owner, repo, base_tree: treeSha, tree: treeEntries,
  });

  const { data: newCommit } = await kit.rest.git.createCommit({
    owner, repo, message, tree: newTree.sha, parents: [commitSha],
  });

  await kit.rest.git.updateRef({ owner, repo, ref: "heads/main", sha: newCommit.sha });
  return newCommit.sha;
}

/* ------------------------------------------------------------------ */
/*  LLM helpers                                                         */
/* ------------------------------------------------------------------ */

type OAIMsg = { role: "system" | "user" | "assistant"; content: string };

interface ImageCtx { base64: string; mime: string }

type GroqContent =
  | string
  | { type: "text"; text: string }[]
  | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

async function callGroq(
  apiKey: string,
  messages: OAIMsg[],
  image?: ImageCtx
): Promise<{ ok: true; text: string } | { ok: false; err: string }> {
  const model = image ? "llama-3.2-11b-vision-preview" : "llama-3.3-70b-versatile";

  const groqMessages = messages.map((m, i) => {
    if (image && m.role === "user" && i === messages.findIndex((x) => x.role === "user")) {
      const content: GroqContent = [
        { type: "text", text: m.content },
        { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.base64}` } },
      ];
      return { role: m.role, content };
    }
    return m;
  });

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: groqMessages, max_tokens: 8192, temperature: 0.2 }),
  });
  if (!res.ok) return { ok: false, err: `Groq ${res.status}` };
  const d = (await res.json()) as { choices: { message: { content: string } }[] };
  return { ok: true, text: d.choices[0]?.message?.content ?? "" };
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  image?: ImageCtx
): Promise<{ ok: true; text: string } | { ok: false; err: string }> {
  const userParts: object[] = [{ text: userMessage }];
  if (image) {
    userParts.push({ inlineData: { mimeType: image.mime, data: image.base64 } });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: userParts }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.2 },
      }),
    }
  );
  if (!res.ok) return { ok: false, err: `Gemini ${res.status}` };
  const d = (await res.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  return { ok: true, text: d.candidates[0]?.content?.parts?.[0]?.text ?? "" };
}

async function callClaude(
  apiKey: string,
  messages: OAIMsg[],
  image?: ImageCtx
): Promise<{ ok: true; text: string } | { ok: false; err: string }> {
  const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
  const nonSystem = messages.filter((m) => m.role !== "system");

  const anthropicMessages = nonSystem.map((m, i) => {
    if (image && m.role === "user" && i === 0) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          { type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 16000,
      system: systemMsg,
      messages: anthropicMessages,
    }),
  });
  if (!res.ok) return { ok: false, err: `Anthropic ${res.status}: ${await res.text()}` };
  const d = (await res.json()) as { content: { type: string; text: string }[] };
  return { ok: true, text: d.content.find((c) => c.type === "text")?.text ?? "" };
}

type PreferredModel = "auto" | "claude" | "groq" | "gemini";

async function callLLM(
  messages: OAIMsg[],
  groqKey?: string,
  geminiKey?: string,
  image?: ImageCtx,
  claudeKey?: string,
  preferred: PreferredModel = "auto"
): Promise<{ text: string; model: string }> {

  const tryGroq = async () => {
    if (!groqKey) return null;
    const r = await callGroq(groqKey, messages, image);
    if (r.ok) return { text: r.text, model: image ? "Groq · Llama 3.2 Vision" : "Groq · Llama 3.3 70B" };
    return null;
  };

  const tryClaude = async () => {
    if (!claudeKey) return null;
    const r = await callClaude(claudeKey, messages, image);
    if (r.ok) return { text: r.text, model: image ? "Claude 3.5 Sonnet · Vision" : "Claude 3.5 Sonnet" };
    return null;
  };

  const tryGemini = async () => {
    if (!geminiKey) return null;
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");
    const r = await callGemini(geminiKey, sys, user, image);
    if (r.ok) return { text: r.text, model: "Gemini 2.0 Flash" };
    return null;
  };

  let result: { text: string; model: string } | null = null;

  if (preferred === "claude") {
    result = await tryClaude() ?? await tryGroq() ?? await tryGemini();
  } else if (preferred === "groq") {
    result = await tryGroq() ?? await tryClaude() ?? await tryGemini();
  } else if (preferred === "gemini") {
    result = await tryGemini() ?? await tryClaude() ?? await tryGroq();
  } else {
    result = await tryClaude() ?? await tryGroq() ?? await tryGemini();
  }

  if (!result) {
    throw new Error("Aucune clé IA configurée. Ajoutez ANTHROPIC_API_KEY, GROQ_API_KEY ou GEMINI_API_KEY.");
  }
  return result;
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

function parseSuggestions(text: string): string[] {
  const m = text.match(/<suggestions>([\s\S]*?)<\/suggestions>/);
  if (!m) return [];
  return m[1]!
    .split("\n")
    .map((l) => l.replace(/^→\s*/, "").trim())
    .filter((l) => l.length > 0);
}

function cleanResponse(text: string): string {
  return text
    .replace(/<read_file\s+path="[^"]+"\s*\/>/g, "")
    .replace(/<write_file\s+path="[^"]+">([\s\S]*?)<\/write_file>/g, "")
    .replace(/<delete_file\s+path="[^"]+"\s*\/>/g, "")
    .replace(/<suggestions>[\s\S]*?<\/suggestions>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                       */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(fileTree: string[]): string {
  return `Tu es un agent de développement web expert de niveau senior. Tu as accès direct à un dépôt GitHub et tu peux lire, créer, modifier et supprimer des fichiers. Tu es capable de construire des sites web complets, des applications full-stack, des APIs, des dashboards, et tout autre projet de développement — de zéro ou à partir de l'existant.

## Arbre du projet (${fileTree.length} fichiers)
${fileTree.map((f) => `  ${f}`).join("\n")}

---

## Tes outils

### Lire un fichier (OBLIGATOIRE avant toute modification)
<read_file path="chemin/vers/fichier.ext" />

Tu peux demander plusieurs lectures simultanément :
<read_file path="src/App.tsx" />
<read_file path="src/components/Header.tsx" />
<read_file path="package.json" />

### Créer ou réécrire un fichier (contenu TOUJOURS intégral)
<write_file path="chemin/vers/fichier.ext">
CONTENU COMPLET DU FICHIER — jamais de "...", jamais de troncature
</write_file>

### Supprimer un fichier
<delete_file path="chemin/vers/fichier.ext" />

---

## Stratégie par type de tâche

### 🏗️ Construire un site/app complet depuis zéro
1. LIS package.json pour connaître le stack (React, Vue, Next.js, Vite, etc.)
2. PLANIFIE mentalement : liste tous les fichiers à créer/modifier
3. LIS les fichiers clés existants (App.tsx, main.tsx, index.css, tailwind.config)
4. CRÉE dans l'ordre : types → utilitaires → composants → pages → routing → config
5. MODIFIE App.tsx / router pour intégrer les nouvelles pages
6. MODIFIE la navigation (Header/Sidebar/Navbar) pour les nouveaux liens
7. VÉRIFIE mentalement la cohérence des imports avant d'écrire

### ➕ Ajouter une page ou fonctionnalité
1. LIS package.json → stack et routeur utilisé
2. LIS App.tsx ou router.tsx → comprendre la structure de routes
3. LIS une page existante → copier le template et les imports
4. LIS la navigation → savoir où ajouter le lien
5. CRÉE la page, METS À JOUR le routeur ET la navigation en une seule fois

### 🎨 Refonte UI / design
1. LIS index.css ou tailwind.config.js → comprendre le thème
2. LIS tous les composants concernés
3. RÉÉCRIS avec le nouveau design, garde la logique intacte

### 🐛 Corriger un bug
1. LIS le fichier concerné ET ses imports/dépendances directs
2. ANALYSE la cause racine
3. CORRIGE de façon chirurgicale en expliquant pourquoi

### 🔌 Intégrer une API / backend
1. LIS la structure existante (routes, hooks, types)
2. CRÉE le service/hook d'appel API
3. INTÈGRE dans les composants concernés
4. GÈRE les états loading/error/success

### 🧪 Ajouter des tests
1. LIS les tests existants pour le pattern
2. CRÉE des tests complets (unit + integration si pertinent)

---

## Règles absolues (violations = échec)

1. **LIS avant d'écrire** — Ne jamais modifier un fichier sans l'avoir lu dans ce tour ou un tour précédent
2. **Contenu intégral** — write_file = fichier complet, zéro ellipse, zéro "reste inchangé"
3. **Tous les fichiers impactés** — Si tu touches App.tsx, mets aussi à jour Sidebar.tsx, Header.tsx, etc.
4. **Imports valides** — Vérifie que chaque import correspond à un fichier qui existe ou que tu vas créer
5. **Même stack, mêmes conventions** — Respecte les patterns existants (composants, hooks, styles)
6. **Ne rien casser** — Si tu n'es pas sûr d'un fichier, lis-le d'abord
7. **Réponses en français** — Explications et commentaires toujours en français
8. **Code en anglais** — Noms de variables, fonctions, fichiers en anglais

---

## Format de réponse attendu

1. **Explication** (2-4 phrases) : ce que tu vas faire et pourquoi
2. **Lectures** si nécessaire : utilise read_file
3. **Modifications** : utilise write_file / delete_file
4. **Résumé** : liste des fichiers créés/modifiés
5. **Suggestions** : toujours 3 actions concrètes

<suggestions>
→ [action courte liée à ce qui vient d'être fait]
→ [prochaine étape logique]
→ [amélioration supplémentaire utile]
</suggestions>`;
}

/* ------------------------------------------------------------------ */
/*  Auto-read key architecture files                                    */
/* ------------------------------------------------------------------ */

const KEY_ARCH_CANDIDATES = [
  "package.json",
  "src/App.tsx",
  "src/App.jsx",
  "App.tsx",
  "app/App.tsx",
  "src/router.tsx",
  "src/routes.tsx",
  "src/main.tsx",
  "src/index.tsx",
  "app/layout.tsx",
  "pages/_app.tsx",
  "pages/_app.jsx",
];

async function autoReadArchitectureFiles(
  kit: Octokit,
  owner: string,
  repo: string,
  fileTree: string[]
): Promise<string> {
  const treeSet = new Set(fileTree);
  const toRead = KEY_ARCH_CANDIDATES.filter((p) => treeSet.has(p)).slice(0, 4);

  if (toRead.length === 0) return "";

  const parts: string[] = [];
  for (const path of toRead) {
    const f = await readFile(kit, owner, repo, path);
    if (f) {
      const truncated = truncateContent(f.content);
      parts.push(`=== ${path} (chargé automatiquement) ===\n\`\`\`\n${truncated}\n\`\`\``);
    }
  }

  if (parts.length === 0) return "";
  return `\n\n## Fichiers d'architecture clés (pré-chargés automatiquement)\n${parts.join("\n\n")}`;
}

/* ------------------------------------------------------------------ */
/*  Shared agentic loop                                                 */
/* ------------------------------------------------------------------ */

interface AgentRunInput {
  message: string;
  currentFile?: string | null;
  imageBase64?: string | null;
  imageMime?: string | null;
  model?: string | null;
  history?: { role: string; content: string }[];
}

interface FileDiff {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
  isDeleted: boolean;
}

interface AgentRunResult {
  response: string;
  filesChanged: string[];
  diffs: FileDiff[];
  commitSha: string | null;
  model: string;
  suggestions: string[];
}

type ProgressFn = (event: Record<string, unknown>) => void;

async function runAgenticLoop(
  kit: Octokit,
  owner: string,
  repo: string,
  input: AgentRunInput,
  keys: { claudeKey?: string; groqKey?: string; geminiKey?: string },
  onProgress?: ProgressFn
): Promise<AgentRunResult> {
  const { message, currentFile, imageBase64, imageMime, history, model } = input;
  const image: ImageCtx | undefined =
    imageBase64 && imageMime ? { base64: imageBase64, mime: imageMime } : undefined;

  const preferred = (model ?? "auto") as PreferredModel;

  /* 1. File tree */
  onProgress?.({ type: "status", message: "📁 Chargement de l'arbre du projet..." });
  const fileTree: string[] = [];
  await collectTree(kit, owner, repo, "", fileTree, 300);

  /* 2. Auto-read architecture files */
  onProgress?.({ type: "status", message: `🔍 Analyse de ${fileTree.length} fichiers...` });
  const archContext = await autoReadArchitectureFiles(kit, owner, repo, fileTree);

  const systemPrompt = buildSystemPrompt(fileTree);

  /* 3. Build initial user message */
  let userMsg = message;
  if (currentFile) userMsg = `Fichier ouvert dans l'éditeur : ${currentFile}\n\n${userMsg}`;
  if (archContext) userMsg = `${userMsg}${archContext}`;

  /* 4. Message array with conversation history */
  const msgs: OAIMsg[] = [{ role: "system", content: systemPrompt }];
  if (history?.length) {
    for (const h of history.slice(-12)) {
      msgs.push({ role: h.role as "user" | "assistant", content: h.content });
    }
  }
  msgs.push({ role: "user", content: userMsg });

  /* 5. Agentic loop — up to 8 read→write cycles, 2 retries per turn */
  const MAX_TURNS = 8;
  const MAX_RETRIES = 2;
  const readDone = new Set<string>();
  const readCache = new Map<string, string>(); // path → old content (for diff)
  let lastText = "";
  let modelName = "";
  let turnCount = 0;

  while (turnCount < MAX_TURNS) {
    turnCount++;
    onProgress?.({ type: "turn", turn: turnCount, message: `🧠 Tour ${turnCount}/${MAX_TURNS} — Réflexion en cours...` });

    let turn: { text: string; model: string } | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const t = await callLLM(msgs, keys.groqKey, keys.geminiKey, turnCount === 1 ? image : undefined, keys.claudeKey, preferred);
        if (t.text.trim().length > 50) {
          turn = t;
          break;
        }
        if (attempt < MAX_RETRIES) {
          onProgress?.({ type: "status", message: `⚠️ Réponse insuffisante, nouvelle tentative (${attempt + 1}/${MAX_RETRIES})...` });
          msgs.push({ role: "assistant", content: t.text });
          msgs.push({ role: "user", content: "Ta réponse était vide ou incomplète. Reprends et effectue les modifications demandées avec write_file." });
        }
      } catch (e) {
        if (attempt === MAX_RETRIES) throw e;
        onProgress?.({ type: "status", message: `⚠️ Erreur LLM, nouvelle tentative (${attempt + 1}/${MAX_RETRIES})...` });
      }
    }

    if (!turn) break;
    lastText = turn.text;
    modelName = turn.model;

    const newPaths = parseReadRequests(lastText).filter((p) => !readDone.has(p));
    if (newPaths.length === 0) break;

    const label = newPaths.slice(0, 3).join(", ") + (newPaths.length > 3 ? `… +${newPaths.length - 3}` : "");
    onProgress?.({ type: "reading", files: newPaths, message: `📖 Lecture de ${newPaths.length} fichier(s) : ${label}` });

    const fileContents: string[] = [];
    for (const p of newPaths.slice(0, 15)) {
      readDone.add(p);
      const f = await readFile(kit, owner, repo, p);
      if (f) {
        readCache.set(p, f.content);
        const truncated = truncateContent(f.content);
        fileContents.push(`=== ${p} ===\n\`\`\`\n${truncated}\n\`\`\``);
      } else {
        fileContents.push(`=== ${p} ===\n(fichier non trouvé — à créer)`);
      }
    }

    msgs.push({ role: "assistant", content: lastText });
    msgs.push({
      role: "user",
      content: `Voici les fichiers demandés (${fileContents.length}) :\n\n${fileContents.join("\n\n")}\n\n---\nEffectue maintenant TOUTES les modifications en une seule réponse. N'oublie aucun fichier impacté.`,
    });
  }

  /* 6. Parse writes & deletes */
  const writes = parseWrites(lastText);
  const deletes = parseDeletes(lastText);
  const filesChanged = [...writes.map((w) => w.path), ...deletes.map((d) => d.path)];

  /* 7. Compute diffs using cached old content */
  const diffs: FileDiff[] = [
    ...writes.map((w) => {
      const old = readCache.get(w.path) ?? null;
      const stats = diffStats(old, w.content);
      return { path: w.path, ...stats, isDeleted: false };
    }),
    ...deletes.map((d) => {
      const old = readCache.get(d.path);
      const lines = old ? old.split("\n").length : 0;
      return { path: d.path, added: 0, removed: lines, isNew: false, isDeleted: true };
    }),
  ];

  /* 8. Commit */
  let commitSha: string | null = null;
  if (writes.length > 0 || deletes.length > 0) {
    onProgress?.({ type: "committing", files: filesChanged, message: `✏️ Commit de ${filesChanged.length} fichier(s)...` });
    const firstLine = cleanResponse(lastText).split("\n")[0]?.slice(0, 72) ?? message.slice(0, 72);
    commitSha = await batchCommit(kit, owner, repo, writes, deletes,
      `feat(agent): ${firstLine}\n\n${filesChanged.map((f) => `- ${f}`).join("\n")}`);
  }

  return {
    response: cleanResponse(lastText),
    filesChanged,
    diffs,
    commitSha,
    model: `${modelName} (${turnCount} tour${turnCount > 1 ? "s" : ""})`,
    suggestions: parseSuggestions(lastText),
  };
}

/* ------------------------------------------------------------------ */
/*  Helper: parse & validate request body                              */
/* ------------------------------------------------------------------ */

function parseAgentRequest(body: unknown):
  | { ok: true; input: AgentRunInput; kit: Octokit; owner: string; repo: string; keys: { claudeKey?: string; groqKey?: string; geminiKey?: string }; error?: never }
  | { ok: false; error: string; status: number } {
  if (!octokit || !currentOwner || !currentRepo) {
    return { ok: false, error: "Non configuré. Connectez d'abord un dépôt GitHub.", status: 400 };
  }
  const parsed = RunAgentBody.safeParse(body);
  if (!parsed.success) return { ok: false, error: "Corps de requête invalide", status: 400 };

  const claudeKey = process.env["ANTHROPIC_API_KEY"];
  const groqKey = process.env["GROQ_API_KEY"];
  const geminiKey = process.env["GEMINI_API_KEY"];

  if (!claudeKey && !groqKey && !geminiKey) {
    return { ok: false, error: "Aucune clé IA configurée. Ajoutez ANTHROPIC_API_KEY, GROQ_API_KEY ou GEMINI_API_KEY.", status: 500 };
  }

  return { ok: true, input: parsed.data, kit: octokit, owner: currentOwner, repo: currentRepo, keys: { claudeKey, groqKey, geminiKey } };
}

/* ------------------------------------------------------------------ */
/*  Routes                                                              */
/* ------------------------------------------------------------------ */

/* JSON route */
router.post("/agent/run", async (req, res) => {
  const ctx = parseAgentRequest(req.body);
  if (!ctx.ok) { res.status(ctx.status).json({ error: ctx.error }); return; }

  try {
    const result = await runAgenticLoop(ctx.kit, ctx.owner, ctx.repo, ctx.input, ctx.keys);
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    req.log.error({ err: e }, "Agent error");
    res.status(500).json({ error: msg });
  }
});

/* SSE streaming route */
router.post("/agent/stream", async (req, res) => {
  const ctx = parseAgentRequest(req.body);
  if (!ctx.ok) { res.status(ctx.status).json({ error: ctx.error }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const result = await runAgenticLoop(ctx.kit, ctx.owner, ctx.repo, ctx.input, ctx.keys, send);
    send({ type: "done", ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    req.log.error({ err: e }, "Agent stream error");
    send({ type: "error", message: msg });
  } finally {
    res.end();
  }
});

export { router as agentRouter };
