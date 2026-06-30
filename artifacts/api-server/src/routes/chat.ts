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

  router.post("/chat/message", async (req, res) => {
    const parsed = SendChatMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    const { message, fileContent, fileName, imageBase64, imageMime } = parsed.data;

    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY not configured" });
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

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: conversationHistory,
            generationConfig: {
              maxOutputTokens: 8192,
              temperature: 0.7,
            },
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        req.log.error({ status: response.status, body: text }, "Gemini error");
        res.status(500).json({ error: `Gemini error: ${response.status}` });
        return;
      }

      const data = (await response.json()) as {
        candidates: { content: { parts: { text: string }[] } }[];
      };

      const reply = data.candidates[0]?.content?.parts?.[0]?.text ?? "";
      conversationHistory.push({ role: "model", parts: [{ text: reply }] });

      res.json({ response: reply });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      req.log.error({ err: e }, "Chat error");
      res.status(500).json({ error: msg });
    }
  });

  router.post("/chat/reset", (_req, res) => {
    conversationHistory = [];
    res.json({ success: true });
  });

  export default router;
  