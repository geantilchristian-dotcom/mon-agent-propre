import { Router, type IRouter } from "express";
  import { SendChatMessageBody } from "@workspace/api-zod";

  const router: IRouter = Router();

  type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };
  type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

  const SYSTEM_PROMPT = `Tu es un expert développeur et agent de modification de code. Ton rôle est d'analyser les fichiers fournis et de proposer des modifications chirurgicales et précises.

  Règles importantes :
  - Réponds TOUJOURS avec le contenu COMPLET du fichier modifié dans un bloc de code, pas seulement les parties modifiées
  - Explique brièvement CE que tu as modifié et POURQUOI avant le bloc de code
  - Ne casse jamais ce qui fonctionne déjà
  - Si tu crées un nouveau fichier, fournis le contenu complet
  - Si une image est fournie, analyse-la attentivement pour comprendre ce que l'utilisateur veut faire
  - Réponds en français sauf si le code l'exige autrement`;

  let conversationHistory: GeminiContent[] = [];

  async function callGemini(
    apiKey: string,
    contents: GeminiContent[],
    retries = 2
  ): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(
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

      if (response.ok) {
        const data = (await response.json()) as {
          candidates: { content: { parts: { text: string }[] } }[];
        };
        const text = data.candidates[0]?.content?.parts?.[0]?.text ?? "";
        return { ok: true, text };
      }

      // 429 = rate limit → wait and retry
      if (response.status === 429 && attempt < retries) {
        const waitMs = (attempt + 1) * 5000; // 5s, 10s
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      const errText = await response.text();
      let friendlyMsg = `Erreur Gemini ${response.status}`;
      if (response.status === 429) {
        friendlyMsg = "Limite de requêtes atteinte (plan gratuit Gemini). Attendez quelques secondes et réessayez.";
      } else if (response.status === 401 || response.status === 403) {
        friendlyMsg = "Clé API Gemini invalide. Vérifiez GEMINI_API_KEY dans Render.";
      }
      return { ok: false, status: response.status, message: friendlyMsg };
    }
    return { ok: false, status: 429, message: "Limite de requêtes. Attendez quelques secondes et réessayez." };
  }

  router.post("/chat/message", async (req, res) => {
    const parsed = SendChatMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    const { message, fileContent, fileName, imageBase64, imageMime } = parsed.data;

    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY non configurée. Ajoutez-la dans Render → Environment." });
      return;
    }

    // Build user parts
    const parts: GeminiPart[] = [];
    const textParts: string[] = [];
    if (fileName && fileContent) {
      textParts.push(`Fichier ouvert : ${fileName}\n\`\`\`\n${fileContent}\n\`\`\``);
    }
    textParts.push(message);
    parts.push({ text: textParts.join("\n\n") });

    if (imageBase64 && imageMime) {
      parts.push({ inline_data: { mime_type: imageMime, data: imageBase64 } });
    }

    conversationHistory.push({ role: "user", parts });

    const result = await callGemini(apiKey, conversationHistory);

    if (!result.ok) {
      req.log.error({ status: result.status }, result.message);
      // Remove the last user message from history on error
      conversationHistory.pop();
      res.status(result.status === 429 ? 429 : 500).json({ error: result.message });
      return;
    }

    conversationHistory.push({ role: "model", parts: [{ text: result.text }] });
    res.json({ response: result.text });
  });

  router.post("/chat/reset", (_req, res) => {
    conversationHistory = [];
    res.json({ success: true });
  });

  export default router;
  