require('dotenv').config();
const express = require('express');
const { Octokit } = require("octokit");
const app = express();

app.use(express.json());
app.use(express.static('public'));

let octokit = null;
let currentRepo = null;
let conversationHistory = [];

app.post('/api/configurer', (req, res) => {
    const { token, repo } = req.body;
    octokit = new Octokit({ auth: token });
    currentRepo = repo;
    res.json({ success: true, message: "Connecté à " + repo });
});

// Route fichiers corrigée pour gérer les types (fichier vs dossier)
app.get('/api/fichiers', async (req, res) => {
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: '' });
        // On renvoie un objet propre pour éviter le "undefined"
        res.json(data.map(f => ({ name: f.name, path: f.path, type: f.type })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lire', async (req, res) => {
    const { path } = req.query;
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        res.json({ content });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

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

app.listen(10000, '0.0.0.0', () => console.log('Serveur actif sur le port 10000'));
