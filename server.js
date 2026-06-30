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
    res.json({ success: true, message: "Connecté à : " + repo });
});

app.get('/api/fichiers', async (req, res) => {
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: '' });
        res.json(Array.isArray(data) ? data.map(f => ({ name: f.name, path: f.path, type: f.type })) : []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lire', async (req, res) => {
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: req.query.path });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        res.json({ content, sha: data.sha });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Route pour Enregistrer les modifications
app.post('/api/ecrire', async (req, res) => {
    const { path, content, sha } = req.body;
    try {
        const [owner, repo] = currentRepo.split('/');
        await octokit.rest.repos.createOrUpdateFileContents({
            owner, repo, path,
            message: "Mise à jour via Agent IDE",
            content: Buffer.from(content).toString('base64'),
            sha: sha
        });
        res.json({ success: true, message: "Sauvegardé avec succès !" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    conversationHistory.push({ role: "user", content: message });
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${process.env.OPENROUTER_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: conversationHistory })
        });
        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        conversationHistory.push({ role: "assistant", content: aiResponse });
        res.json({ success: true, response: aiResponse });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(10000, '0.0.0.0', () => console.log('Serveur actif sur 10000'));
