require('dotenv').config();
const express = require('express');
const { Octokit } = require("octokit");
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Stockage dynamique pour la configuration GitHub de l'utilisateur
let userOctokit = null;
let currentRepo = null;
let conversationHistory = [];

// Route : Configuration dynamique de l'agent
app.post('/api/configurer', (req, res) => {
    const { token, repo } = req.body;
    if (!token || !repo) return res.status(400).json({ error: "Token et Repo requis" });
    
    userOctokit = new Octokit({ auth: token });
    currentRepo = repo; // Format attendu: "proprietaire/nom-du-repo"
    
    res.json({ success: true, message: `Connecté avec succès au dépôt : ${repo}` });
});

// Route : Lecture automatique de fichier depuis GitHub
async function lireFichierGitHub(pathToFile) {
    if (!userOctokit || !currentRepo) return "Agent non configuré.";
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await userOctokit.rest.repos.getContent({
            owner, repo, path: pathToFile,
        });
        return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (e) { return `Erreur lecture GitHub : ${e.message}`; }
}

// Route : Discussion IA avec Mémoire
app.post('/api/chat', async (req, res) => {
    const { message, filename } = req.body;
    
    // Récupération automatique du contenu si un fichier est fourni
    const fileContent = filename ? await lireFichierGitHub(filename) : "Aucun fichier spécifié.";
    
    conversationHistory.push({ 
        role: "user", 
        content: `Contexte du fichier ${filename}:\n${fileContent}\n\nInstruction: ${message}` 
    });

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

// Route : Reset Mémoire
app.post('/api/reset', (req, res) => {
    conversationHistory = [];
    res.json({ success: true, message: "Mémoire réinitialisée." });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
