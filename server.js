require('dotenv').config(); // Charge le fichier .env
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const OPENROUTER_KEY = process.env.OPENROUTER_KEY;

// Fonction de sécurité : Backup avant modification
async function sauvegarder(filename) {
    const backupDir = path.join(__dirname, 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    try {
        const contenu = await fs.readFile(filename, 'utf8');
        const nomBackup = `${filename}-${Date.now()}.bak`;
        await fs.writeFile(path.join(backupDir, nomBackup), contenu);
        return nomBackup;
    } catch (err) {
        console.error("Erreur backup:", err);
        return null;
    }
}

// Route 1 : Discussion avec l'IA
app.post('/api/chat', async (req, res) => {
    const { message, filename } = req.body;
    try {
        let fileContent = "";
        if (filename) {
            try { fileContent = await fs.readFile(filename, 'utf8'); } 
            catch (e) { fileContent = "Fichier non trouvé."; }
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Mon Agent IDE"
            },
            body: JSON.stringify({
                "model": "openai/gpt-4o-mini",
                "messages": [{ "role": "user", "content": `Fichier: ${filename}\nContenu:\n${fileContent}\n\nInstruction: ${message}` }]
            })
        });
        const data = await response.json();
        res.json({ success: true, response: data.choices[0].message.content });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Route 2 : Application du code (avec backup automatique)
app.post('/api/appliquer', async (req, res) => {
    const { filename, code } = req.body;
    if (!filename || !code) return res.status(400).json({ error: "Données incomplètes" });

    try {
        const backupName = await sauvegarder(filename);
        await fs.writeFile(filename, code);
        res.json({ success: true, message: `Sauvegarde réussie (${backupName}) et fichier mis à jour.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serveur sécurisé lancé sur http://localhost:${PORT}`));