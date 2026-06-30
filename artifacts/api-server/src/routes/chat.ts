import { Router, type IRouter } from "express";
import { SendChatMessageBody } from "@workspace/api-zod";

const router: IRouter = Router();

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type OpenAIMessage = { role: "system" | "user" | "assistant"; content: string | { type: string; text?: string; image_url?: { url: string } }[] };

const SYSTEM_PROMPT = `Tu es un expert développeur et agent de modification de code. Ton rôle est d'analyser les fichiers fournis et de proposer des modifications chirurgicales et précises.

Règles importantes :
- Réponds TOUJOURS avec le contenu COMPLET du fichier modifié dans un bloc de code, pas seulement les parties modifiées
- Explique brièvement CE que tu as modifié et POURQUOI avant le bloc de code
- Ne casse jamais ce qui fonctionne déjà
- Si tu crées un nouveau fichier, fournis le contenu complet
- Si une image est fournie, analyse-la attentivement pour comprendre ce que l'utilisateur veut faire
- Réponds en français sauf si le code l'exige autrement`;

let geminiHistory: GeminiContent[] = [];
let openAIHistory: OpenAIMessage[] = [];

async function callGroq(
  apiKey: string,
  messages: OpenAIMessage[]
): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, max_tokens: 8192, temperature: 0.7 }),
  });
  if (res.ok) {
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return { ok: true, text: data.choices[0]?.message?.content ?? "" };
  }
  let msg = `Erreur Groq ${res.status}`;
  if (res.status === 429) msg = "Limite Groq atteinte, basculement sur Gemini…";
  if (res.status === 401) msg = "Clé Groq invalide (GROQ_API_KEY manquante).";
  return { ok: false, status: res.status, message: msg };
}

async function callGemini(
  apiKey: string,
  contents: GeminiContent[],
  retries = 1
): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { maxOutputTokens: 8192, temperature: 0.7 },
        }),
      }
    );
    if (res.ok) {
      const data = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
      return { ok: true, text: data.candidates[0]?.content?.parts?.[0]?.text ?? "" };
    }
    if (res.status === 429 && attempt < retries) { await new Promise(r => setTimeout(r, 5000)); continue; }
    let msg = `Erreur Gemini ${res.status}`;
    if (res.status === 429) msg = "Limites Groq et Gemini atteintes. Attendez quelques secondes.";
    if (res.status === 401 || res.status === 403) msg = "Clé Gemini invalide (GEMINI_API_KEY manquante).";
    return { ok: false, status: res.status, message: msg };
  }
  return { ok: false, status: 429, message: "Toutes les limites atteintes. Réessayez dans quelques secondes." };
}

router.post("/chat/message", async (req, res) => {
  const parsed = SendChatMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const { message, fileContent, fileName, imageBase64, imageMime } = parsed.data;
  const groqKey   = process.env["GROQ_API_KEY"];
  const geminiKey = process.env["GEMINI_API_KEY"];

  if (!groqKey && !geminiKey) {
    res.status(500).json({ error: "Aucune clé IA configurée. Ajoutez GROQ_API_KEY ou GEMINI_API_KEY dans les variables d'environnement." });
    return;
  }

  const textParts: string[] = [];
  if (fileName && fileContent) textParts.push(`Fichier ouvert : ${fileName}\n\`\`\`\n${fileContent}\n\`\`\``);
  textParts.push(message);
  const userText = textParts.join("\n\n");

  if (groqKey) {
    const msgs: OpenAIMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...openAIHistory];
    const userContent: OpenAIMessage["content"] = imageBase64 && imageMime
      ? [{ type: "text", text: userText }, { type: "image_url", image_url: { url: `data:${imageMime};base64,${imageBase64}` } }]
      : userText;
    msgs.push({ role: "user", content: userContent });

    const result = await callGroq(groqKey, msgs);
    if (result.ok) {
      openAIHistory.push({ role: "user", content: userContent });
      openAIHistory.push({ role: "assistant", content: result.text });
      req.log.info({ model: "groq/llama-3.3-70b-versatile" }, "Chat OK");
      res.json({ response: result.text, model: "Groq · Llama 3.3 70B" });
      return;
    }
    if (result.status !== 429) { res.status(500).json({ error: result.message }); return; }
    req.log.warn("Groq rate-limited, falling back to Gemini");
  }

  if (!geminiKey) { res.status(429).json({ error: "Limite Groq atteinte et GEMINI_API_KEY non configurée." }); return; }

  const parts: GeminiPart[] = [{ text: userText }];
  if (imageBase64 && imageMime) parts.push({ inline_data: { mime_type: imageMime, data: imageBase64 } });
  geminiHistory.push({ role: "user", parts });

  const result = await callGemini(geminiKey, geminiHistory);
  if (!result.ok) {
    geminiHistory.pop();
    res.status(result.status === 429 ? 429 : 500).json({ error: result.message });
    return;
  }
  geminiHistory.push({ role: "model", parts: [{ text: result.text }] });
  res.json({ response: result.text, model: "Gemini 2.0 Flash" });
});

router.post("/chat/reset", (_req, res) => {
  geminiHistory = [];
  openAIHistory = [];
  res.json({ success: true });
});

export default router;
