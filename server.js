require('dotenv').config();
const express = require('express');
const { Octokit } = require("octokit");
const app = express();

app.use(express.json());
app.use(express.static('public'));

let octokit = null;
let currentRepo = null;
let conversationHistory = [];

// 1. Initialisation de la session
app.post('/api/configurer', (req, res) => {
    const { token, repo } = req.body;
    octokit = new Octokit({ auth: token });
    currentRepo = repo;
    conversationHistory = [{ 
        role: "system", 
        content: "Tu es un expert développeur. Analyse le fichier fourni et propose des modifications précises. Réponds avec des blocs de code que l'utilisateur peut copier facilement." 
    }];
    res.json({ success: true });
});

// 2. Listing sécurisé
app.get('/api/fichiers', async (req, res) => {
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: '' });
        res.json(Array.isArray(data) ? data : [data]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. Lecture avec gestion d'erreurs (Fichiers vs Dossiers)
app.get('/api/lire', async (req, res) => {
    const { path } = req.query;
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
        
        if (Array.isArray(data)) {
            res.json({ type: 'directory' }); // On indique que c'est un dossier pour le frontend
        } else {
            const content = Buffer.from(data.content, 'base64').toString('utf8');
            res.json({ type: 'file', content, sha: data.sha });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. Écriture
app.post('/api/ecrire', async (req, res) => {
    const { path, content, sha } = req.body;
    try {
        const [owner, repo] = currentRepo.split('/');
        await octokit.rest.repos.createOrUpdateFileContents({
            owner, repo, path,
            message: "MAJ Agent IDE",
            content: Buffer.from(content).toString('base64'),
            sha
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5. Chat Intelligent (contexte + historique)
app.post('/api/chat', async (req, res) => {
    const { message, fileContent, fileName } = req.body;
    
    conversationHistory.push({ 
        role: "user", 
        content: `Fichier : ${fileName}\nContenu :\n${fileContent}\n\nQuestion : ${message}` 
    });
    
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${process.env.OPENROUTER_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: conversationHistory })
        });
        
        const data = await response.json();
        const reply = data.choices[0].message.content;
        
        conversationHistory.push({ role: "assistant", content: reply });
        res.json({ response: reply });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log('Serveur actif'));
