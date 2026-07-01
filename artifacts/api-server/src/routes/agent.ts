import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { Octokit } from "octokit";
import { RunAgentBody } from "@workspace/api-zod";

const router: IRouter = Router();

let octokit: Octokit | null = null;
let currentOwner: string | null = null;
let currentRepo: string | null = null;

/* ------------------------------------------------------------------ */
/*  Staged commits (confirm-before-push mode)                          */
/* ------------------------------------------------------------------ */

interface StagedCommit {
  writes: { path: string; content: string }[];
  deletes: { path: string }[];
  kit: Octokit;
  owner: string;
  repo: string;
  message: string;
  expiresAt: number;
}

const stagedCommits = new Map<string, StagedCommit>();

/* Expire staged commits older than 30 minutes */
setInterval(() => {
  const now = Date.now();
  for (const [id, sc] of stagedCommits) {
    if (now > sc.expiresAt) stagedCommits.delete(id);
  }
}, 5 * 60 * 1000).unref();

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

async function getDefaultBranch(kit: Octokit, owner: string, repo: string): Promise<string> {
  try {
    const { data } = await kit.rest.repos.get({ owner, repo });
    return data.default_branch;
  } catch { return "main"; }
}

async function getHeadSha(
  kit: Octokit,
  owner: string,
  repo: string
): Promise<{ commitSha: string; treeSha: string }> {
  const branch = await getDefaultBranch(kit, owner, repo);
  const { data: ref } = await kit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
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
  image?: ImageCtx,
  /** If true, only try the 70b model (skip 8b to avoid 413 on large prompts) */
  only70b = false,
): Promise<{ ok: true; text: string; model: string } | { ok: false; err: string }> {
  const visionModels = ["llama-3.2-11b-vision-preview", "llama-4-scout-17b-16e-instruct"];
  const visionModel = visionModels[0]!;
  // Full cascade of Groq models — ordered by quality, each with a different rate-limit bucket
  const fullTextModels = [
    "llama-3.3-70b-versatile",          // flagship, 128k context
    "llama-4-scout-17b-16e-instruct",   // Llama 4, fast and capable
    "deepseek-r1-distill-llama-70b",    // reasoning model
    "qwen-qwq-32b",                     // Qwen reasoning, 128k context
    "llama-3.1-70b-versatile",          // fallback 70b
    "gemma2-9b-it",                     // small but always available
    "llama-3.1-8b-instant",             // last resort (413 risk on large prompts)
  ];
  const textModels = only70b
    ? fullTextModels.slice(0, 5)        // skip small models in auto mode
    : fullTextModels;

  const buildMessages = (model: string) => messages.map((m, i) => {
    if (image && m.role === "user" && i === messages.findIndex((x) => x.role === "user")) {
      if (model === visionModel) {
        const content: GroqContent = [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.base64}` } },
        ];
        return { role: m.role, content };
      }
    }
    return m;
  });

  const modelsToTry = image ? [visionModel, ...textModels] : textModels;
  const lastErrors: string[] = [];

  for (const model of modelsToTry) {
    // For smaller models, truncate to last 4 messages and system prompt to avoid 413
    const isSmallModel = model.includes("8b") || model.includes("gemma") || model.includes("mixtral") || model.includes("3b");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msgs: any[];
    if (isSmallModel) {
      const sys = messages[0];
      const rest = messages.slice(1).slice(-4);
      // Truncate system prompt to 2000 chars for tiny models
      const compactSys = sys ? { ...sys, content: sys.content.slice(0, 2000) } : null;
      msgs = [compactSys, ...rest].filter(Boolean);
    } else {
      msgs = buildMessages(model);
    }

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: msgs, max_tokens: 4096, temperature: 0.2 }),
    });
    if (res.ok) {
      const d = (await res.json()) as { choices: { message: { content: string } }[] };
      return { ok: true, text: d.choices[0]?.message?.content ?? "", model };
    }
    const body = await res.text().catch(() => "");
    lastErrors.push(`${model} ${res.status}: ${body.slice(0, 100)}`);
    // Retry on 429 (rate limit), 413 (too large), 400 (sometimes decommissioned models) — stop on auth errors
    if (res.status !== 429 && res.status !== 413 && res.status !== 400) break;
  }

  return { ok: false, err: `Groq: ${lastErrors.join(" → ")}` };
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  image?: ImageCtx
): Promise<{ ok: true; text: string; model: string } | { ok: false; err: string }> {
  const geminiModels = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
  ];

  const userParts: object[] = [{ text: userMessage }];
  if (image) {
    userParts.push({ inlineData: { mimeType: image.mime, data: image.base64 } });
  }

  const lastErrors: string[] = [];

  for (const model of geminiModels) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
    if (res.ok) {
      const d = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
      return { ok: true, text: d.candidates[0]?.content?.parts?.[0]?.text ?? "", model };
    }
    const body = await res.text().catch(() => "");
    lastErrors.push(`${model} ${res.status}: ${body.slice(0, 100)}`);
    // Retry on 429 (quota) or 404 (model alias not found on this key)
    if (res.status !== 429 && res.status !== 404) break;
  }

  return { ok: false, err: `Gemini: ${lastErrors.join(" → ")}` };
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

/* ------------------------------------------------------------------ */
/*  OpenRouter — OpenAI-compatible, many free models                   */
/* ------------------------------------------------------------------ */

async function callOpenRouter(
  apiKey: string,
  messages: OAIMsg[],
): Promise<{ ok: true; text: string; model: string } | { ok: false; err: string }> {
  // 12 free models on OpenRouter — each has its own independent rate-limit bucket
  const freeModels = [
    "meta-llama/llama-4-scout:free",                        // Llama 4 Scout (newest)
    "meta-llama/llama-4-maverick:free",                     // Llama 4 Maverick
    "meta-llama/llama-3.3-70b-instruct:free",               // Llama 3.3 70B
    "deepseek/deepseek-r1-distill-llama-70b:free",          // DeepSeek R1 reasoning
    "deepseek/deepseek-chat-v3-0324:free",                  // DeepSeek Chat v3
    "qwen/qwq-32b:free",                                    // Qwen QwQ 32B reasoning
    "qwen/qwen-2.5-72b-instruct:free",                      // Qwen 2.5 72B
    "nvidia/llama-3.1-nemotron-70b-instruct:free",          // NVIDIA Nemotron 70B
    "mistralai/mistral-small-3.2-24b-instruct:free",        // Mistral Small 24B
    "google/gemma-3-27b-it:free",                           // Gemma 3 27B
    "mistralai/mistral-7b-instruct:free",                   // Mistral 7B (fallback)
    "meta-llama/llama-3.2-3b-instruct:free",               // Llama 3.2 3B (last resort)
  ];

  const lastErrors: string[] = [];

  for (const model of freeModels) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://mon-agent-propre.onrender.com",
        "X-Title": "Agent IDE",
      },
      body: JSON.stringify({ model, messages, max_tokens: 8192, temperature: 0.2 }),
    });
    if (res.ok) {
      const d = (await res.json()) as { choices: { message: { content: string } }[] };
      const text = d.choices[0]?.message?.content ?? "";
      if (text) return { ok: true, text, model: model.split("/").pop()?.replace(":free", "") ?? model };
    }
    const body = await res.text().catch(() => "");
    lastErrors.push(`${model.split("/").pop()} ${res.status}: ${body.slice(0, 80)}`);
    if (res.status === 401) break;
  }

  return { ok: false, err: `OpenRouter: ${lastErrors.join(" → ")}` };
}

type PreferredModel = "auto" | "claude" | "groq" | "gemini" | "gpt";

/* ------------------------------------------------------------------ */
/*  OpenAI — GPT-4o and fallbacks                                      */
/* ------------------------------------------------------------------ */

async function callOpenAI(
  apiKey: string,
  messages: OAIMsg[],
  image?: ImageCtx,
): Promise<{ ok: true; text: string; model: string } | { ok: false; err: string }> {
  const models = ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"];
  const lastErrors: string[] = [];

  for (const model of models) {
    const oaiMessages = messages.map((m, i) => {
      if (image && m.role === "user" && i === messages.findIndex((x) => x.role === "user")) {
        return {
          role: m.role,
          content: [
            { type: "text" as const, text: m.content },
            { type: "image_url" as const, image_url: { url: `data:${image.mime};base64,${image.base64}` } },
          ],
        };
      }
      return m;
    });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: oaiMessages, max_tokens: 8192, temperature: 0.2 }),
    });
    if (res.ok) {
      const d = (await res.json()) as { choices: { message: { content: string } }[] };
      return { ok: true, text: d.choices[0]?.message?.content ?? "", model };
    }
    const body = await res.text().catch(() => "");
    lastErrors.push(`${model} ${res.status}: ${body.slice(0, 120)}`);
    if (res.status !== 429) break;
  }

  return { ok: false, err: `OpenAI: ${lastErrors.join(" → ")}` };
}

async function callLLM(
  messages: OAIMsg[],
  groqKey?: string,
  geminiKey?: string,
  image?: ImageCtx,
  claudeKey?: string,
  preferred: PreferredModel = "auto",
  openrouterKey?: string,
  openaiKey?: string,
): Promise<{ text: string; model: string }> {

  const errors: string[] = [];

  const tryGroq = async (only70b = false) => {
    if (!groqKey) return null;
    const r = await callGroq(groqKey, messages, image, only70b);
    if (r.ok) return { text: r.text, model: `Groq · ${r.model}` };
    errors.push(r.err);
    return null;
  };

  const tryClaude = async () => {
    if (!claudeKey) return null;
    const r = await callClaude(claudeKey, messages, image);
    if (r.ok) return { text: r.text, model: image ? "Claude 3.5 Sonnet · Vision" : "Claude 3.5 Sonnet" };
    errors.push(`Claude: ${r.err}`);
    return null;
  };

  const tryGemini = async () => {
    if (!geminiKey) return null;
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");
    const r = await callGemini(geminiKey, sys, user, image);
    if (r.ok) return { text: r.text, model: `Gemini · ${r.model}` };
    errors.push(r.err);
    return null;
  };

  const tryOpenRouter = async () => {
    if (!openrouterKey) return null;
    const r = await callOpenRouter(openrouterKey, messages);
    if (r.ok) return { text: r.text, model: `OpenRouter · ${r.model}` };
    errors.push(r.err);
    return null;
  };

  // OpenRouter vision-capable models (multimodal)
  const tryOpenRouterVision = async () => {
    if (!openrouterKey) return null;
    const visionModels = [
      "qwen/qwen2.5-vl-72b-instruct:free",
      "qwen/qwen2.5-vl-7b-instruct:free",
      "meta-llama/llama-4-scout:free",
      "meta-llama/llama-4-maverick:free",
      "google/gemma-3-27b-it:free",
    ];
    const lastErrors: string[] = [];
    for (const model of visionModels) {
      const oaiMessages = messages.map((m, i) => {
        if (image && m.role === "user" && i === messages.findIndex((x) => x.role === "user")) {
          return { role: m.role, content: [
            { type: "text" as const, text: m.content },
            { type: "image_url" as const, image_url: { url: `data:${image.mime};base64,${image.base64}` } },
          ]};
        }
        return m;
      });
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openrouterKey}`,
          "HTTP-Referer": "https://mon-agent-propre.onrender.com",
          "X-Title": "Agent IDE",
        },
        body: JSON.stringify({ model, messages: oaiMessages, max_tokens: 8192, temperature: 0.2 }),
      });
      if (res.ok) {
        const d = (await res.json()) as { choices: { message: { content: string } }[] };
        const text = d.choices[0]?.message?.content ?? "";
        if (text) return { text, model: `OpenRouter Vision · ${model.split("/").pop()?.replace(":free", "") ?? model}` };
      }
      const body = await res.text().catch(() => "");
      lastErrors.push(`${model.split("/").pop()} ${res.status}: ${body.slice(0, 60)}`);
      if (res.status === 401) break;
    }
    errors.push(`OpenRouter Vision: ${lastErrors.join(" → ")}`);
    return null;
  };

  const tryGPT = async () => {
    if (!openaiKey) return null;
    const r = await callOpenAI(openaiKey, messages, image);
    if (r.ok) return { text: r.text, model: `GPT · ${r.model}` };
    errors.push(r.err);
    return null;
  };

  let result: { text: string; model: string } | null = null;

  if (image) {
    // Vision cascade — only vision-capable models, in order of reliability
    // Gemini = ALL variants support vision (4 fallbacks)
    // Claude = vision ✓, GPT-4o = vision ✓, Groq Vision = 3 models, OpenRouter = qwen-vl + llama4
    result = await tryGemini()
          ?? await tryClaude()
          ?? await tryGPT()
          ?? await tryGroq()           // tries llama vision models first
          ?? await tryOpenRouterVision();
  } else if (preferred === "gpt") {
    result = await tryGPT() ?? await tryClaude() ?? await tryGroq() ?? await tryGemini() ?? await tryOpenRouter();
  } else if (preferred === "claude") {
    result = await tryClaude() ?? await tryGPT() ?? await tryGroq() ?? await tryGemini() ?? await tryOpenRouter();
  } else if (preferred === "groq") {
    result = await tryGroq() ?? await tryOpenRouter() ?? await tryClaude() ?? await tryGPT() ?? await tryGemini();
  } else if (preferred === "gemini") {
    result = await tryGemini() ?? await tryClaude() ?? await tryGPT() ?? await tryOpenRouter() ?? await tryGroq();
  } else {
    // auto: Groq 70b only (skip 8b → 413) → OpenRouter (12 free models) → Gemini → Claude → GPT
    result = await tryGroq(true) ?? await tryOpenRouter() ?? await tryGemini() ?? await tryClaude() ?? await tryGPT();
  }

  if (!result) {
    const detail = errors.length > 0 ? ` Erreurs: ${errors.join(" | ")}` : " Vérifiez vos clés API.";
    throw new Error(`Toutes les APIs IA ont échoué.${detail}`);
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

function parseEdits(text: string): { path: string; old: string; new: string }[] {
  const edits: { path: string; old: string; new: string }[] = [];
  const re = /<edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[2]!;
    const oldMatch = inner.match(/<old>([\s\S]*?)<\/old>/);
    const newMatch = inner.match(/<new>([\s\S]*?)<\/new>/);
    if (oldMatch && newMatch) {
      edits.push({
        path: m[1]!,
        old: oldMatch[1]!.replace(/^\n/, "").replace(/\n$/, ""),
        new: newMatch[1]!.replace(/^\n/, "").replace(/\n$/, ""),
      });
    }
  }
  return edits;
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
    .replace(/<edit_file\s+path="[^"]+">([\s\S]*?)<\/edit_file>/g, "")
    .replace(/<delete_file\s+path="[^"]+"\s*\/>/g, "")
    .replace(/<suggestions>[\s\S]*?<\/suggestions>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                       */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(fileTree: string[], userInstructions?: string): string {
  const hasProject = fileTree.length > 0;
  const instructionBlock = userInstructions?.trim()
    ? `\n\n## 📌 Préférences mémorisées par l'utilisateur (APPLIQUE-LES TOUJOURS)\n${userInstructions.trim()}\n`
    : "";
  return `# 🤖 Identité complète — Elianex Code

Tu es **Elianex Code**, un agent IA de développement autonome construit sur mesure, intégré dans un IDE web personnel similaire à Cursor ou Replit Agent. Tu n'es PAS ChatGPT, PAS l'agent Replit, PAS Claude seul — tu es **Elianex Code**, une entité propre avec une architecture, des capacités et un rôle définis ici exhaustivement.${instructionBlock}

---

## 🧠 Qui tu es

Tu es à la fois :
- Un **développeur senior full-stack** : tu lis, analyses, modifies, crées et supprimes des fichiers dans des dépôts GitHub
- Un **assistant conversationnel universel** : tu réponds à toutes les questions sans exception — code, architecture, debug, concepts, maths, histoire, ou n'importe quel sujet
- Un **agent autonome multi-tour** : tu peux effectuer jusqu'à 8 tours de raisonnement par requête pour résoudre des tâches complexes
- Un **analyste de code** : tu lis les fichiers clés du projet avant d'agir pour comprendre l'architecture existante

---

## ⚙️ Tes modèles IA intégrés

Tu fonctionnes sur plusieurs modèles IA configurés sur ce serveur. Selon le modèle sélectionné par l'utilisateur (mode "Auto" ou choix explicite), tu peux être propulsé par :

| Fournisseur | Modèles disponibles | Capacités spéciales |
|-------------|--------------------|--------------------|
| **Groq** | llama-3.3-70b-versatile, llama-3.1-8b-instant | Ultra-rapide, faible latence |
| **Groq Vision** | llama-3.2-11b-vision-preview | Analyse d'images et screenshots |
| **Google Gemini** | gemini-2.5-flash, gemini-2.0-flash, gemini-2.5-flash-lite, gemini-2.0-flash-lite | Contexte très long, multimodal |
| **Anthropic Claude** | claude-3-5-sonnet-20241022 | Code de haute qualité, vision |
| **OpenAI GPT** | gpt-4o, gpt-4o-mini, gpt-3.5-turbo | Polyvalent, vision |
| **OpenRouter** | meta-llama/llama-3.3-70b-instruct et autres | Accès à de nombreux modèles via proxy |

En mode **Auto**, le système essaie dans l'ordre : Groq → Claude → Gemini → OpenRouter → GPT, selon les clés API disponibles.

---

## 🛠️ Tes outils et capacités

### Capacités de gestion de fichiers GitHub
Quand un dépôt GitHub est connecté, tu peux :
- **Lire** n'importe quel fichier du dépôt (avec mise en cache)
- **Modifier** chirurgicalement des fichiers existants (remplacement exact old→new)
- **Créer** de nouveaux fichiers avec contenu complet
- **Supprimer** des fichiers
- **Committer** directement ou soumettre pour confirmation (mode staging)
- **Auto-lire** les fichiers d'architecture clés (package.json, App.tsx, router, main, etc.) au début de chaque session

### Capacités de vision
Tu peux analyser des **images et screenshots** envoyés par l'utilisateur. Utilise cette capacité pour :
- Identifier des bugs visuels dans une interface
- Comprendre une maquette ou un design
- Analyser des messages d'erreur en capture d'écran

### Mémoire des préférences utilisateur
L'utilisateur peut te donner des instructions permanentes (ex: "réponds toujours en anglais", "utilise toujours Tailwind"). Ces préférences sont stockées et injectées dans chaque requête. Tu dois les respecter en permanence.

### Auto-correction
Si une modification de fichier échoue (texte <old> introuvable), tu te corriges automatiquement en relisant le fichier et en réessayant avec le bon contenu.

---

## 📁 Outils fichiers — Syntaxe XML

${hasProject ? `### Lire un fichier (OBLIGATOIRE avant toute modification)
<read_file path="chemin/vers/fichier.ext" />

### Modifier un fichier EXISTANT — chirurgical
<edit_file path="chemin/vers/fichier.ext">
<old>
texte exact à remplacer (copié mot pour mot depuis le fichier lu)
</old>
<new>
nouveau texte qui le remplace
</new>
</edit_file>

Plusieurs <edit_file> possibles pour le même fichier si plusieurs zones changent.

### Créer un fichier NOUVEAU
<write_file path="chemin/vers/nouveau-fichier.ext">
CONTENU COMPLET du nouveau fichier
</write_file>

### Supprimer un fichier
<delete_file path="chemin/vers/fichier.ext" />

---

## 📋 Projet connecté — ${fileTree.length} fichiers
${fileTree.map((f) => `  ${f}`).join("\n")}` : `## Aucun projet GitHub connecté
Tu peux répondre à toutes les questions générales. Pour coder sur un dépôt, l'utilisateur doit connecter un dépôt GitHub dans la sidebar (onglet Fichiers).`}

---

## 📏 Règles ABSOLUES de modification de code

1. **LIS TOUJOURS avant de modifier** — <read_file /> est OBLIGATOIRE avant tout edit_file. Sans le fichier lu, tu ne connais pas le contenu exact.
2. **N'utilise PAS edit_file si tu n'as pas lu le fichier.** Demande d'abord la lecture, attends le contenu, puis rédige l'edit.
3. **edit_file pour existants, write_file pour nouveaux** — Ne réécris jamais un fichier existant entier avec write_file.
4. **old = copie exacte mot pour mot** — Même indentation, espaces, ponctuation, sauts de ligne. La moindre différence fait échouer.
5. **Chirurgical** — Ne modifie QUE ce qui est demandé. Pas de reformatage ni réindentation inutiles.
6. **Scope minimal** — Ne touche qu'à la fonction / composant concerné.
7. **Respecte le stack existant** — Patterns, bibliothèques, conventions du projet.

---

## 💬 Règle de réponse — TOUJOURS RÉPONDRE

**Tu dois répondre à TOUTE question sans exception**, quelle que soit sa nature :
- Question générale, technique, hors-sujet, ambiguë → réponds du mieux possible
- Ne laisse JAMAIS une réponse vide. Si tu ne comprends pas, explique et propose une reformulation.
- Combine explications et modifications de code dans la même réponse si pertinent.

---

## 🌍 Langue et format

- **Réponds dans la langue du message reçu** (français si français, anglais si anglais, etc.)
- **Code et noms de fichiers** toujours en anglais
- Sois direct et concis pour les questions conversationnelles
- Pour les tâches de code : explique brièvement ce que tu vas faire, puis applique
- **Termine toujours par 3 suggestions** d'actions concrètes et pertinentes :

<suggestions>
→ [suggestion 1]
→ [suggestion 2]
→ [suggestion 3]
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
  userInstructions?: string | null;
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
  stagedId: string | null;
  model: string;
  suggestions: string[];
}

type ProgressFn = (event: Record<string, unknown>) => void;

async function runAgenticLoop(
  kit: Octokit | null,
  owner: string | null,
  repo: string | null,
  input: AgentRunInput,
  keys: { claudeKey?: string; groqKey?: string; geminiKey?: string; openrouterKey?: string; openaiKey?: string },
  onProgress?: ProgressFn,
  autoCommit = true
): Promise<AgentRunResult> {
  const { message, currentFile, imageBase64, imageMime, history, model, userInstructions } = input;
  const image: ImageCtx | undefined =
    imageBase64 && imageMime ? { base64: imageBase64, mime: imageMime } : undefined;

  const preferred = (model ?? "auto") as PreferredModel;

  const hasGitHub = !!(kit && owner && repo);

  /* 1. File tree (only if GitHub connected) */
  const fileTree: string[] = [];
  if (hasGitHub) {
    onProgress?.({ type: "status", message: "📁 Chargement de l'arbre du projet..." });
    await collectTree(kit!, owner!, repo!, "", fileTree, 300);
  }

  /* 2. Auto-read architecture files (only if GitHub connected) */
  let archContext = "";
  if (hasGitHub && fileTree.length > 0) {
    onProgress?.({ type: "status", message: `🔍 Analyse de ${fileTree.length} fichiers...` });
    archContext = await autoReadArchitectureFiles(kit!, owner!, repo!, fileTree);
  }

  const systemPrompt = buildSystemPrompt(fileTree, userInstructions ?? undefined);

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
        const t = await callLLM(msgs, keys.groqKey, keys.geminiKey, turnCount === 1 ? image : undefined, keys.claudeKey, preferred, keys.openrouterKey, keys.openaiKey);
        /* Accept any non-empty response — short conversational answers are valid */
        if (t.text.trim().length > 0) {
          turn = t;
          break;
        }
        if (attempt < MAX_RETRIES) {
          onProgress?.({ type: "status", message: `⚠️ Réponse vide, nouvelle tentative (${attempt + 1}/${MAX_RETRIES})...` });
          msgs.push({ role: "assistant", content: t.text });
          msgs.push({ role: "user", content: "Ta réponse était complètement vide. Réponds à la question posée." });
        }
      } catch (e) {
        if (attempt === MAX_RETRIES) throw e;
        onProgress?.({ type: "status", message: `⚠️ Erreur LLM, nouvelle tentative (${attempt + 1}/${MAX_RETRIES})...` });
      }
    }

    if (!turn) break;
    lastText = turn.text;
    modelName = turn.model;

    /* --- Detect writes/edits that target files not yet read, force a read turn --- */
    if (hasGitHub) {
      const pendingEdits = parseEdits(lastText).map((e) => e.path);
      /* write_file on existing tree paths is also suspicious — check those too */
      const pendingWrites = parseWrites(lastText)
        .map((w) => w.path)
        .filter((p) => fileTree.includes(p));
      const unread = [...new Set([...pendingEdits, ...pendingWrites])].filter(
        (p) => !readDone.has(p) && fileTree.includes(p)
      );
      if (unread.length > 0) {
        /* Agent tried to modify without reading — inject the file contents and loop again */
        onProgress?.({ type: "reading", files: unread, message: `📖 Lecture préalable obligatoire : ${unread.slice(0, 3).join(", ")}` });
        const injected: string[] = [];
        for (const p of unread.slice(0, 10)) {
          readDone.add(p);
          const f = await readFile(kit!, owner!, repo!, p);
          if (f) {
            readCache.set(p, f.content);
            injected.push(`=== ${p} ===\n\`\`\`\n${truncateContent(f.content)}\n\`\`\``);
          } else {
            injected.push(`=== ${p} ===\n(fichier non trouvé — utilise write_file pour le créer)`);
          }
        }
        msgs.push({ role: "assistant", content: lastText });
        msgs.push({
          role: "user",
          content: `⛔ Tu as tenté de modifier des fichiers sans les avoir lus. Voici leur contenu exact :\n\n${injected.join("\n\n")}\n\n---\nMaintenant refais ta réponse complète avec des balises <old> copiées mot pour mot depuis ces fichiers.`,
        });
        continue; /* next turn with file content injected */
      }
    }

    const newPaths = parseReadRequests(lastText).filter((p) => !readDone.has(p));
    if (newPaths.length === 0) break;

    const label = newPaths.slice(0, 3).join(", ") + (newPaths.length > 3 ? `… +${newPaths.length - 3}` : "");
    onProgress?.({ type: "reading", files: newPaths, message: `📖 Lecture de ${newPaths.length} fichier(s) : ${label}` });

    const fileContents: string[] = [];
    for (const p of newPaths.slice(0, 15)) {
      readDone.add(p);
      if (!hasGitHub) {
        fileContents.push(`=== ${p} ===\n(GitHub non connecté — impossible de lire)`);
        continue;
      }
      const f = await readFile(kit!, owner!, repo!, p);
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

  /* 5b. Safety fallback — if lastText is somehow empty, return a graceful message */
  if (!lastText.trim()) {
    lastText = "Je n'ai pas pu générer de réponse pour cette demande. Pourriez-vous reformuler votre question ?";
    modelName = modelName || "fallback";
  }

  /* 6. Parse writes, edits & deletes */
  const rawWrites = parseWrites(lastText);
  const rawEdits = parseEdits(lastText);
  const deletes = parseDeletes(lastText);

  /* Apply edit_file patches: old→new string replacement on cached content */
  const editErrors: string[] = [];
  const editedWrites: { path: string; content: string }[] = [];

  for (const edit of rawEdits) {
    let base = readCache.get(edit.path) ?? null;
    if (base === null && hasGitHub) {
      const f = await readFile(kit!, owner!, repo!, edit.path);
      if (f) { base = f.content; readCache.set(edit.path, f.content); }
    }
    if (base === null) {
      editErrors.push(`edit_file "${edit.path}": fichier introuvable`);
      continue;
    }
    if (!base.includes(edit.old)) {
      editErrors.push(`edit_file "${edit.path}": le texte <old> n'a pas été trouvé exactement — vérifiez l'indentation et la ponctuation`);
      continue;
    }
    const patched = base.replace(edit.old, edit.new);
    // Merge with any existing write for the same path (multiple edits on same file)
    const existing = editedWrites.find((w) => w.path === edit.path);
    if (existing) {
      existing.content = existing.content.replace(edit.old, edit.new);
    } else {
      editedWrites.push({ path: edit.path, content: patched });
      readCache.set(edit.path, patched); // update cache for subsequent edits on same file
    }
  }

  // If there were edit errors, feed them back so the agent can self-correct
  if (editErrors.length > 0 && hasGitHub) {
    msgs.push({ role: "assistant", content: lastText });
    msgs.push({ role: "user", content: `Erreurs d'application des edit_file :\n${editErrors.map((e) => `- ${e}`).join("\n")}\n\nRelis le fichier avec read_file et corrige tes balises <old> pour qu'elles correspondent exactement au contenu.` });
    // Re-run one more turn to self-correct
    const correction = await callLLM(msgs, keys.groqKey, keys.geminiKey, undefined, keys.claudeKey, preferred, keys.openrouterKey, keys.openaiKey).catch(() => null);
    if (correction && correction.text.trim().length > 50) {
      lastText = correction.text;
      const correctedEdits = parseEdits(lastText);
      for (const edit of correctedEdits) {
        const base = readCache.get(edit.path);
        if (base && base.includes(edit.old)) {
          const patched = base.replace(edit.old, edit.new);
          editedWrites.push({ path: edit.path, content: patched });
          readCache.set(edit.path, patched);
        }
      }
      rawWrites.push(...parseWrites(lastText));
    }
  }

  const writes = [...rawWrites, ...editedWrites];
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

  /* 8. Commit or stage */
  let commitSha: string | null = null;
  let stagedId: string | null = null;
  const hasChanges = writes.length > 0 || deletes.length > 0;
  const firstLine = cleanResponse(lastText).split("\n")[0]?.slice(0, 72) ?? message.slice(0, 72);
  const commitMessage = `feat(agent): ${firstLine}\n\n${filesChanged.map((f) => `- ${f}`).join("\n")}`;

  if (hasChanges && hasGitHub) {
    if (autoCommit) {
      onProgress?.({ type: "committing", files: filesChanged, message: `✏️ Commit de ${filesChanged.length} fichier(s)...` });
      commitSha = await batchCommit(kit!, owner!, repo!, writes, deletes, commitMessage);
    } else {
      /* Stage for user confirmation */
      stagedId = crypto.randomUUID();
      stagedCommits.set(stagedId, {
        writes, deletes,
        kit: kit!, owner: owner!, repo: repo!,
        message: commitMessage,
        expiresAt: Date.now() + 30 * 60 * 1000,
      });
      onProgress?.({ type: "staged", files: filesChanged, message: `⏳ ${filesChanged.length} fichier(s) prêts — en attente de confirmation.` });
    }
  } else if (hasChanges && !hasGitHub) {
    onProgress?.({ type: "status", message: "⚠️ GitHub non connecté — les modifications ne peuvent pas être commitées." });
  }

  return {
    response: cleanResponse(lastText),
    filesChanged,
    diffs,
    commitSha,
    stagedId,
    model: `${modelName} (${turnCount} tour${turnCount > 1 ? "s" : ""})`,
    suggestions: parseSuggestions(lastText),
  };
}

/* ------------------------------------------------------------------ */
/*  Helper: parse & validate request body                              */
/* ------------------------------------------------------------------ */

function parseAgentRequest(body: unknown):
  | { ok: true; input: AgentRunInput; kit: Octokit | null; owner: string | null; repo: string | null; keys: { claudeKey?: string; groqKey?: string; geminiKey?: string; openrouterKey?: string; openaiKey?: string }; error?: never }
  | { ok: false; error: string; status: number } {
  const parsed = RunAgentBody.safeParse(body);
  if (!parsed.success) return { ok: false, error: "Corps de requête invalide", status: 400 };

  const claudeKey = process.env["ANTHROPIC_API_KEY"];
  const groqKey = process.env["GROQ_API_KEY"];
  const geminiKey = process.env["GEMINI_API_KEY"];
  const openrouterKey = process.env["OPENROUTER_KEY"];
  const openaiKey = process.env["OPENAI_API_KEY"];

  if (!claudeKey && !groqKey && !geminiKey && !openrouterKey && !openaiKey) {
    return { ok: false, error: "Aucune clé IA configurée. Ajoutez ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, GEMINI_API_KEY ou OPENROUTER_KEY dans les variables d'environnement.", status: 500 };
  }

  /* If server-side state was lost (e.g. after a restart), recover from
     the _githubToken / _githubRepo fields the client sends as fallback */
  let kit = octokit ?? null;
  let owner = currentOwner ?? null;
  let repo = currentRepo ?? null;

  if (!kit) {
    const bodyObj = body as Record<string, unknown>;
    const fallbackToken = typeof bodyObj["_githubToken"] === "string" ? bodyObj["_githubToken"] : null;
    const fallbackRepo = typeof bodyObj["_githubRepo"] === "string" ? bodyObj["_githubRepo"] : null;
    if (fallbackToken && fallbackRepo) {
      const [fbOwner, fbRepo] = fallbackRepo.split("/");
      if (fbOwner && fbRepo) {
        kit = new Octokit({ auth: fallbackToken });
        owner = fbOwner;
        repo = fbRepo;
        /* Also restore server state so subsequent requests reuse it */
        setAgentGithub(kit, fbOwner, fbRepo);
      }
    }
  }

  const bodyObj2 = body as Record<string, unknown>;
  const userInstructions = typeof bodyObj2["userInstructions"] === "string" ? bodyObj2["userInstructions"] : null;

  return { ok: true, input: { ...parsed.data, userInstructions }, kit, owner, repo, keys: { claudeKey, groqKey, geminiKey, openrouterKey, openaiKey } };
}

/* ------------------------------------------------------------------ */
/*  API abuse protection middleware                                     */
/* ------------------------------------------------------------------ */

const AGENT_SECRET = process.env["AGENT_SECRET"] ?? null;

function requireSecret(req: Request, res: Response, next: NextFunction): void {
  if (!AGENT_SECRET) { next(); return; }
  const header = req.headers["x-agent-secret"];
  const body = (req.body as Record<string, unknown>)?.["_agentSecret"];
  if (header === AGENT_SECRET || body === AGENT_SECRET) { next(); return; }
  res.status(401).json({ error: "Non autorisé — clé API manquante." });
}

/* ------------------------------------------------------------------ */
/*  LLM health-check endpoint                                          */
/* ------------------------------------------------------------------ */

router.get("/agent/health", async (_req, res) => {
  const groqKey    = process.env["GROQ_API_KEY"];
  const geminiKey  = process.env["GEMINI_API_KEY"];
  const openaiKey  = process.env["OPENAI_API_KEY"];
  const openrouterKey = process.env["OPENROUTER_KEY"];
  const claudeKey  = process.env["ANTHROPIC_API_KEY"];

  type FetchResult = { status: number; ok: boolean };
  const ping = async (name: string, fn: () => Promise<FetchResult>): Promise<{ name: string; ok: boolean; latency: number; error?: string }> => {
    if (!({ groq: groqKey, gemini: geminiKey, gpt: openaiKey, openrouter: openrouterKey, claude: claudeKey } as Record<string, string | undefined>)[name]) {
      return { name, ok: false, latency: 0, error: "Clé non configurée" };
    }
    const t0 = Date.now();
    try {
      const r = await fn();
      const latency = Date.now() - t0;
      if (r.status === 401 || r.status === 403) return { name, ok: false, latency, error: `Clé invalide (${r.status})` };
      if (r.status === 429) return { name, ok: false, latency, error: "Quota épuisé (429)" };
      return { name, ok: r.ok, latency, error: r.ok ? undefined : `HTTP ${r.status}` };
    } catch (e) {
      return { name, ok: false, latency: Date.now() - t0, error: String(e) };
    }
  };

  const doFetch = (url: string, init: RequestInit): Promise<FetchResult> =>
    (globalThis.fetch(url, init) as Promise<{ status: number; ok: boolean }>);

  const results = await Promise.all([
    ping("groq", () => doFetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
    })),
    ping("gemini", () => doFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: 1 } }),
      }
    )),
    ping("gpt", () => doFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
    })),
    ping("openrouter", () => doFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey}`, "HTTP-Referer": "https://mon-agent-propre.onrender.com" },
      body: JSON.stringify({ model: "meta-llama/llama-3.3-70b-instruct:free", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
    })),
    ping("claude", () => doFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": claudeKey!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-3-5-sonnet-20241022", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    })),
  ]);

  const anyOk = results.some((r) => r.ok);
  res.status(anyOk ? 200 : 503).json({ providers: results, anyAvailable: anyOk });
});

/* ------------------------------------------------------------------ */
/*  Routes                                                              */
/* ------------------------------------------------------------------ */

/* JSON route */
router.post("/agent/run", async (req, res) => {
  const ctx = parseAgentRequest(req.body);
  if (!ctx.ok) { res.status(ctx.status).json({ error: ctx.error }); return; }
  const autoCommit = (req.body as Record<string, unknown>)["autoCommit"] !== false;

  try {
    const result = await runAgenticLoop(ctx.kit, ctx.owner, ctx.repo, ctx.input, ctx.keys, undefined, autoCommit);
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
  const autoCommit = (req.body as Record<string, unknown>)["autoCommit"] !== false;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const result = await runAgenticLoop(ctx.kit, ctx.owner, ctx.repo, ctx.input, ctx.keys, send, autoCommit);
    send({ type: "done", ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    req.log.error({ err: e }, "Agent stream error");
    send({ type: "error", message: msg });
  } finally {
    res.end();
  }
});

/* Confirm staged commit route */
router.post("/agent/commit-staged", async (req, res) => {
  const { stagedId } = req.body as { stagedId?: string };
  if (!stagedId) { res.status(400).json({ error: "stagedId requis" }); return; }

  const staged = stagedCommits.get(stagedId);
  if (!staged) { res.status(404).json({ error: "Staged commit introuvable ou expiré (30 min max)" }); return; }

  stagedCommits.delete(stagedId);
  try {
    const commitSha = await batchCommit(staged.kit, staged.owner, staged.repo, staged.writes, staged.deletes, staged.message);
    res.json({ commitSha });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    req.log.error({ err: e }, "Staged commit error");
    res.status(500).json({ error: msg });
  }
});

export { router as agentRouter };
