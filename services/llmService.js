const axios = require('axios');

// Fonction utilitaire pour créer un délai (Pause)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fonction utilitaire pour calculer le jour actuel de l'année (1-365 ou 366)
function getDayOfYear() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now - start;
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
}

async function generateStory() {
    const themes = ["espoir et Jésus", "courage et Jésus", "pardon et Jésus", "patience, fruit du Saint-Esprit", "foi en Jésus dans l'épreuve", "joie partagée en Jésus", "fidélité à Jésus", "Jésus fils de Dieu et sauveur de l'humanité"];
    
    // Calcul mathématique pour une sélection séquentielle basée sur la date
    const dayOfYear = getDayOfYear();
    const themeIndex = dayOfYear % themes.length;
    const selectedTheme = themes[themeIndex];

    // ==========================================
    // ÉTAPE 1 : PROMPT DIRECTEUR (Réflexion)
    // ==========================================
    const step1Prompt = `Trouve un verset ou une séquence biblique intéressante ou inspirante. 
    IMPORTANT: Avec comme thème : ${selectedTheme}, choisis d'abord un verset qui correspond.
    Analyse l'idée et le message spirituel qui en découlent.
    Ensuite, agis comme un directeur créatif et rédige un prompt détaillé destiné à un écrivain. Ce prompt devra exiger de l'écrivain qu'il rédige une histoire moderne, profonde et subtile (une parabole moderne) qui transmet ce message implicitement (le thème de l'histoire est: ${selectedTheme}), comme Jésus expliquait au moyen de paraboles. 
    Décris dans ce prompt l'ambiance, les thèmes à aborder, le développement émotionnel, et précise que le personnage principal DOIT avoir un nom original et se trouver dans un décor de rêve qui est familier au lecteur cible.
    IMPORTANT : Ne rédige pas l'histoire toi-même. Rédige UNIQUEMENT le prompt détaillé pour l'écrivain.`;

    console.log(`Étape 1 : Création du prompt directeur (Thème du jour: ${selectedTheme})...`);
    // On passe "false" car on attend du texte brut, pas du JSON
    const writerPrompt = await executeGeminiCall(step1Prompt, false); 
    console.log("✅ Prompt directeur généré avec succès !");

    // ==========================================
    // ÉTAPE 2 : RÉDACTION ET FORMATAGE JSON
    // ==========================================
    const step2Prompt = `Voici des directives créatives pour écrire une parabole moderne :
    ---
    ${writerPrompt}
    ---
    En suivant rigoureusement ces directives, rédige l'histoire.
    Renvoie UNIQUEMENT un JSON strict avec cette structure :
    {
      "verset": "Référence du verset qui a inspiré l'histoire",
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

    console.log("Étape 2 : Rédaction de l'histoire et formatage JSON...");
    // On passe "true" car on attend un JSON strict à parser
    const storyJson = await executeGeminiCall(step2Prompt, true);
    console.log("✅ Histoire finale générée et formatée avec succès !");

    return storyJson;
}

// ==========================================
// MOTEUR D'EXÉCUTION ET DE GESTION D'ERREURS
// ==========================================
async function executeGeminiCall(promptText, expectJson = true) {
    const primaryKey = process.env.GEMINI_API_KEY;
    const backupKey = process.env.GEMINI_API_KEY_BACKUP || primaryKey; 
    const MAX_RETRIES = 3; 

    // 1. TENTATIVES AVEC LA CLÉ PRINCIPALE (RETRY + BACKOFF)
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await callGeminiAPI(primaryKey, promptText, expectJson);
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

    // 2. PLAN B : TENTATIVE AVEC CLÉ DE SECOURS
    if (process.env.GEMINI_API_KEY_BACKUP) { 
        console.log("🔄 Basculement sur la clé Gemini de secours (Plan B)..."); 
        try {
            return await callGeminiAPI(backupKey, promptText, expectJson);
        } catch (backupError) {
            console.error("❌ Échec également sur la clé Gemini de secours:", backupError.message); 
        }
    }

    throw new Error("Échec total de l'appel Gemini (Toutes les tentatives ont échoué)."); 
}

// ==========================================
// APPEL BRUT À L'API GEMINI
// ==========================================
async function callGeminiAPI(key, promptText, expectJson) {
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
    
    // Si on s'attend à du JSON, on nettoie et on parse. Sinon, on renvoie le texte brut.
    if (expectJson) {
        const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim(); 
        return JSON.parse(jsonStr); 
    }
    
    return rawText.trim();
}

module.exports = { generateStory };