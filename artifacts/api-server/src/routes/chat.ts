import { Router, type IRouter } from "express";
import { SendChatMessageBody } from "@workspace/api-zod";

const router: IRouter = Router();

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image_url"; image_url: { url: string } };
type MessageContent = string | (TextContent | ImageContent)[];

type Message = { role: "system" | "user" | "assistant"; content: MessageContent };

const SYSTEM_PROMPT = `Tu es un expert développeur et agent de modification de code. Ton rôle est d'analyser les fichiers fournis et de proposer des modifications chirurgicales et précises.

Règles importantes :
- Réponds TOUJOURS avec le contenu COMPLET du fichier modifié dans un bloc de code, pas seulement les parties modifiées
- Explique brièvement CE que tu as modifié et POURQUOI avant le bloc de code
- Ne casse jamais ce qui fonctionne déjà
- Si tu crées un nouveau fichier, fournis le contenu complet
- Si une image est fournie, analyse-la attentivement pour comprendre ce que l'utilisateur veut faire
- Réponds en français sauf si le code l'exige autrement`;

let conversationHistory: Message[] = [
  { role: "system", content: SYSTEM_PROMPT },
];

router.post("/chat/message", async (req, res) => {
  const parsed = SendChatMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const { message, fileContent, fileName, imageBase64, imageMime } = parsed.data;

  const apiKey = process.env["OPENROUTER_KEY"];
  if (!apiKey) {
    res.status(500).json({ error: "OPENROUTER_KEY not configured" });
    return;
  }

  // Build user message content — supports text + optional image
  let userContent: MessageContent;

  const textParts: string[] = [];
  if (fileName && fileContent) {
    textParts.push(`Fichier ouvert : ${fileName}\n\`\`\`\n${fileContent}\n\`\`\``);
  }
  textParts.push(message);
  const fullText = textParts.join("\n\n");

  if (imageBase64 && imageMime) {
    const dataUrl = `data:${imageMime};base64,${imageBase64}`;
    userContent = [
      { type: "text", text: fullText },
      { type: "image_url", image_url: { url: dataUrl } },
    ];
  } else {
    userContent = fullText;
  }

  conversationHistory.push({ role: "user", content: userContent });

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        max_tokens: 8192,
        messages: conversationHistory,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      req.log.error({ status: response.status, body: text }, "OpenRouter error");
      res.status(500).json({ error: `OpenRouter error: ${response.status}` });
      return;
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    const reply = data.choices[0]?.message?.content ?? "";
    conversationHistory.push({ role: "assistant", content: reply });

    res.json({ response: reply });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    req.log.error({ err: e }, "Chat error");
    res.status(500).json({ error: msg });
  }
});

router.post("/chat/reset", (_req, res) => {
  conversationHistory = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  res.json({ success: true });
});

export default router;
