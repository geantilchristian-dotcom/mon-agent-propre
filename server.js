require('dotenv').config();
const express = require('express');
const { Octokit } = require("octokit");
const app = express();

app.use(express.json());
app.use(express.static('public'));

// État global pour la session de l'IDE
let octokit = null;
let currentRepo = null;
let conversationHistory = [];

// 1. Initialisation de la connexion GitHub
app.post('/api/configurer', (req, res) => {
    const { token, repo } = req.body;
    if (!token || !repo) return res.status(400).json({ error: "Champs requis" });
    
    octokit = new Octokit({ auth: token });
    currentRepo = repo;
    conversationHistory = [{ 
        role: "system", 
        content: "Tu es un expert développeur. Lorsque l'utilisateur demande une modification sur un fichier, fournis uniquement le bloc de code corrigé ou la modification ciblée, pas tout le fichier. Sois concis." 
    }];
    res.json({ success: true, message: "Connecté à : " + repo });
});

// 2. Récupération de la liste des fichiers
app.get('/api/fichiers', async (req, res) => {
    try {
        const [owner, repo] = currentRepo.split('/');
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: '' });
        res.json(Array.isArray(data) ? data : [data]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. Lecture d'un fichier (avec SHA pour la sauvegarde future)
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

// 4. Écriture / Sauvegarde sur GitHub
app.post('/api/ecrire', async (req, res) => {
    const { path, content, sha } = req.body;
    try {
        const [owner, repo] = currentRepo.split('/');
        await octokit.rest.repos.createOrUpdateFileContents({
            owner, repo, path,
            message: "Mise à jour via mon Agent IDE",
            content: Buffer.from(content).toString('base64'),
            sha: sha
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5. Moteur de discussion intelligent (Contextuel)
app.post('/api/chat', async (req, res) => {
    const { message, fileContent, fileName } = req.body;
    
    // Ajout du contexte dans l'historique
    conversationHistory.push({ 
        role: "user", 
        content: `Fichier en cours : ${fileName}\nContenu actuel :\n${fileContent}\n\nQuestion de l'utilisateur : ${message}` 
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
        
        conversationHistory.push({ role: "assistant", content: aiReply });
        res.json({ response: aiReply });
    } catch (e) { 
        res.status(500).json({ error: "Erreur IA : " + e.message }); 
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Serveur opérationnel sur le port ${PORT}`));
