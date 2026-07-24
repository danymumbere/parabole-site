const axios = require('axios');

// Fonction utilitaire pour créer un délai (Pause)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateStory() {
    const themes = ["l'espoir", "le courage", "le pardon", "la patience", "la foi dans l'épreuve", "la joie partagée", "la fidélité"];
    const randomTheme = themes[Math.floor(Math.random() * themes.length)];

    const prompt = `Trouve un verset ou une séquence biblique intéressante ou inspirante. Ayant compris l'idée ou le message qui en découle, tu as comme objectif de transmettre cette idée implicitement par une histoire moderne. Tu le fera comme Jésus expliquait au moyen de paraboles.  
    IMPORTANT: Choisis un verset qui parle de : ${randomTheme}. 
    Le personnage principal DOIT avoir un nom original.
    Renvoie UNIQUEMENT un JSON strict avec cette structure :
    {
      "verset": "Référence du verset",
      "titre": "Titre de l'histoire",
      "consistance": {
        "personnagePrincipal": "Description physique en anglais, ex: 'A young man with short brown hair, wearing a simple blue jacket'",
        "lieuPrincipal": "Description en anglais",
        "objetCle": "Description en anglais"
      },
      "scenes": [
        { 
          "texte": "Narration de la scène en français...", 
          "imagePrompt": "Prompt en anglais incluant le personnagePrincipal. Full frame composition, modern minimalist graphic design, 2D flat illustration, not 3D." 
        }
      ]
    }`;

    // On récupère la clé principale et la clé de secours (si définie dans Render)
    const primaryKey = process.env.GEMINI_API_KEY;
    const backupKey = process.env.GEMINI_API_KEY_BACKUP || primaryKey; 

    // 1. TENTATIVES AVEC LA CLÉ PRINCIPALE (RETRY + BACKOFF)
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (attempt === 1) console.log("Tentative de rédaction de l'histoire avec Gemini (Clé principale)...");
            
            const response = await callGeminiAPI(primaryKey, prompt);
            console.log("✅ Histoire générée avec succès via Gemini !");
            return response;

        } catch (error) {
            const status = error.response ? error.response.status : null;
            if ((status === 503 || status === 429) && attempt < MAX_RETRIES) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                console.warn(`⚠️ Gemini surchargé (Erreur ${status}). Nouvelle tentative dans ${Math.round(delay)}ms... (Essai ${attempt}/${MAX_RETRIES})`);
                await sleep(delay);
            } else {
                console.warn(`❌ Échec Gemini Clé Principale (Erreur: ${status || error.message}).`);
                break;
            }
        }
    }

    // 2. PLAN B : TENTATIVE AVEC CLÉ DE SECOURS (Si configurée)
    if (process.env.GEMINI_API_KEY_BACKUP) {
        console.log("🔄 Basculement sur la clé Gemini de secours (Plan B)...");
        try {
            const response = await callGeminiAPI(backupKey, prompt);
            console.log("✅ Histoire générée avec succès via la Clé Gemini de secours !");
            return response;
        } catch (backupError) {
            console.error("❌ Échec également sur la clé Gemini de secours:", backupError.message);
        }
    }

    throw new Error("Échec total de la génération de texte (Toutes les tentatives Gemini ont échoué).");
}

// Fonction utilitaire pour exécuter la requête vers l'API Gemini
async function callGeminiAPI(key, promptText) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;
    
    const response = await axios.post(url, {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
            temperature: 1.0, 
            topP: 0.95,       
            topK: 40          
        }
    });

    const rawText = response.data.candidates[0].content.parts[0].text;
    const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr);
}

module.exports = { generateStory };