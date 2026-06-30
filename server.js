require('dotenv').config();
const express = require('express');
const { Octokit } = require("octokit");
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Variables globales de session (pour l'utilisateur actuel)
let octokit = null;
let currentRepo = null;
let conversationHistory = [];

// 1. Configuration de l'agent
app.post('/api/configurer', (req, res) => {
    const { token, repo } = req.body;
    octokit = new Octokit({ auth: token });
    currentRepo = repo;
    conversationHistory = []; // Reset mémoire lors d'un nouveau dépôt
    res.json({ success: true, message: `Connecté au dépôt : ${repo}` });
});

// 2. Exploration des fichiers
app.get('/api/fichiers', async (req, res) => {
    if (!octokit) return res.status(401).json({ error: "Non configuré" });
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: '' });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. Lecture précise d'un fichier
app.get('/api/lire', async (req, res) => {
    const { path } = req.query;
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        res.json({ content });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. Moteur de discussion avec l'IA
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    conversationHistory.push({ role: "user", content: message });

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini",
                messages: conversationHistory
            })
        });
        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        
        conversationHistory.push({ role: "assistant", content: aiResponse });
        res.json({ success: true, response: aiResponse });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5. Port Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Serveur IDE actif sur le port ${PORT}`));
