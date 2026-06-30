require('dotenv').config();
const express = require('express');
const { Octokit } = require("octokit");
const app = express();

app.use(express.json());
app.use(express.static('public'));

let octokit = null;
let currentRepo = null;
let conversationHistory = [];

// 1. Configuration et Connexion GitHub
app.post('/api/configurer', (req, res) => {
    const { token, repo } = req.body;
    octokit = new Octokit({ auth: token });
    currentRepo = repo;
    // Réinitialisation de l'historique lors d'une nouvelle connexion
    conversationHistory = [{ 
        role: "system", 
        content: "Tu es un expert développeur. Modifie uniquement les parties du code demandées. Si l'utilisateur demande une modification, réponds en proposant le bloc de code corrigé sans tout réécrire inutilement." 
    }];
    res.json({ success: true, message: "Connecté à : " + repo });
});

// 2. Lister les fichiers
app.get('/api/fichiers', async (req, res) => {
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: '' });
        res.json(Array.isArray(data) ? data : [data]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. Lire le contenu d'un fichier
app.get('/api/lire', async (req, res) => {
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: req.query.path });
        res.json({ 
            content: Buffer.from(data.content, 'base64').toString('utf8'), 
            sha: data.sha 
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. Enregistrer les modifications
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
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5. Chat Intelligent avec Historique
app.post('/api/chat', async (req, res) => {
    const { message, fileContent, fileName } = req.body;
    
    // Ajout du message utilisateur avec le contexte du fichier
    conversationHistory.push({ 
        role: "user", 
        content: `Fichier : ${fileName}\nContenu actuel :\n${fileContent}\n\nDemande de l'utilisateur : ${message}` 
    });
    
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
        const aiReply = data.choices[0].message.content;
        
        // Sauvegarde de la réponse dans l'historique
        conversationHistory.push({ role: "assistant", content: aiReply });
        
        res.json({ response: aiReply });
    } catch (e) { 
        res.status(500).json({ error: "Erreur IA : " + e.message }); 
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Serveur prêt sur port ${PORT}`));
