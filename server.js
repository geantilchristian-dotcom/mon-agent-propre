require('dotenv').config();
const express = require('express');
const { Octokit } = require("octokit");
const app = express();
app.use(express.json());
app.use(express.static('public'));

let octokit = null;
let currentRepo = null;
let conversationHistory = [];

// Connexion dynamique
app.post('/api/configurer', (req, res) => {
    const { token, repo } = req.body;
    octokit = new Octokit({ auth: token });
    currentRepo = repo;
    res.json({ success: true, message: "Connecté à " + repo });
});

// Lister les fichiers
app.get('/api/fichiers', async (req, res) => {
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: '' });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Appliquer modif et Commiter
app.post('/api/modifier', async (req, res) => {
    const { path, content, message } = req.body;
    const [owner, repo] = currentRepo.split('/');
    const { data: fileData } = await octokit.rest.repos.getContent({ owner, repo, path });
    
    await octokit.rest.repos.createOrUpdateFileContents({
        owner, repo, path, message,
        content: Buffer.from(content).toString('base64'),
        sha: fileData.sha
    });
    res.json({ success: true, message: "Modifié avec succès sur GitHub !" });
});

// Chat avec contexte
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    conversationHistory.push({ role: "user", content: message });
    // Ici, insérer l'appel API OpenRouter comme vu précédemment...
    res.json({ success: true, response: "IA a reçu : " + message });
});

app.listen(10000, '0.0.0.0', () => console.log('Serveur Pro actif'));
