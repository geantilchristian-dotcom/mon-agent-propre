require('dotenv').config();
const express = require('express');
const { Octokit } = require("octokit");
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Initialisation de la connexion GitHub
const octokit = new Octokit({ 
    auth: process.env.GITHUB_TOKEN 
});

// Route de test pour vérifier la connexion GitHub
app.get('/api/test-github', async (req, res) => {
    try {
        const { data } = await octokit.rest.users.getAuthenticated();
        res.json({ success: true, message: `Connecté à GitHub en tant que : ${data.login}` });
    } catch (error) {
        res.status(500).json({ success: false, error: "Erreur de connexion GitHub : " + error.message });
    }
});

// Route 1 : Discussion avec l'IA
app.post('/api/chat', async (req, res) => {
    const { message, filename } = req.body;
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
                "messages": [{ "role": "user", "content": `Instruction: ${message}` }]
            })
        });
        const data = await response.json();
        res.json({ success: true, response: data.choices[0].message.content });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// Route 2 : Application du code
app.post('/api/appliquer', async (req, res) => {
    const { filename, code } = req.body;
    if (!filename || !code) return res.status(400).json({ error: "Données incomplètes" });

    try {
        // Sauvegarde locale sur le serveur
        const backupDir = path.join(__dirname, 'backups');
        await fs.mkdir(backupDir, { recursive: true });
        await fs.writeFile(path.join(backupDir, `${filename}-${Date.now()}.bak`), code);
        
        // Mise à jour du fichier local
        await fs.writeFile(filename, code);
        
        res.json({ success: true, message: "Fichier mis à jour avec succès." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Configuration du port pour Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur actif sur le port ${PORT}`);
});
