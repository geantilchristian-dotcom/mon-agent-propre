require('dotenv').config();
const express = require('express');
const { Octokit } = require("octokit");
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// 1. Initialisation Octokit pour GitHub
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// 2. Mémoire de la conversation
let conversationHistory = [];

// Route de test GitHub
app.get('/api/test-github', async (req, res) => {
    try {
        const { data } = await octokit.rest.users.getAuthenticated();
        res.json({ success: true, message: `Connecté à GitHub : ${data.login}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Route 3 : Discussion IA avec Mémoire
app.post('/api/chat', async (req, res) => {
    const { message, filename } = req.body;
    conversationHistory.push({ role: "user", content: `Fichier: ${filename}. Instruction: ${message}` });

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://mon-agent-propre.onrender.com",
                "X-Title": "Mon Agent IDE"
            },
            body: JSON.stringify({
                "model": "openai/gpt-4o-mini",
                "messages": conversationHistory
            })
        });
        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        
        conversationHistory.push({ role: "assistant", content: aiResponse });
        res.json({ success: true, response: aiResponse });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Route 4 : Application du code et Reset Mémoire
app.post('/api/appliquer', async (req, res) => {
    const { filename, code } = req.body;
    try {
        await fs.writeFile(filename, code);
        res.json({ success: true, message: "Fichier mis à jour." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reset', (req, res) => {
    conversationHistory = [];
    res.json({ success: true, message: "Mémoire IA réinitialisée." });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
