const axios = require('axios'); //

// Fonction utilitaire pour créer un délai (Pause)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)); //

async function generateStory() {
    const themes = ["l'espoir", "le courage", "le pardon", "la patience", "la foi dans l'épreuve", "la joie partagée", "la fidélité"]; //[cite: 1]
    const randomTheme = themes[Math.floor(Math.random() * themes.length)]; //[cite: 1]

    // ==========================================
    // ÉTAPE 1 : PROMPT DIRECTEUR (Réflexion)
    // ==========================================
    const step1Prompt = `Trouve un verset ou une séquence biblique intéressante ou inspirante. 
    IMPORTANT: Choisis un verset qui parle de : ${randomTheme}.
    Analyse l'idée et le message spirituel qui en découlent.
    Ensuite, agis comme un directeur créatif et rédige un prompt détaillé destiné à un écrivain. Ce prompt devra exiger de l'écrivain qu'il rédige une histoire moderne, profonde et subtile (une parabole moderne) qui transmet ce message implicitement, comme Jésus expliquait au moyen de paraboles. 
    Décris dans ce prompt l'ambiance, les thèmes à aborder, le développement émotionnel, et précise que le personnage principal DOIT avoir un nom original.
    IMPORTANT : Ne rédige pas l'histoire toi-même. Rédige UNIQUEMENT le prompt détaillé pour l'écrivain.`;

    console.log(`Étape 1 : Création du prompt directeur (Thème: ${randomTheme})...`);
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
    }`; //[cite: 1]

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
    const primaryKey = process.env.GEMINI_API_KEY; //[cite: 1]
    const backupKey = process.env.GEMINI_API_KEY_BACKUP || primaryKey; //[cite: 1]
    const MAX_RETRIES = 3; //[cite: 1]

    // 1. TENTATIVES AVEC LA CLÉ PRINCIPALE (RETRY + BACKOFF)
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await callGeminiAPI(primaryKey, promptText, expectJson);
        } catch (error) {
            const status = error.response ? error.response.status : null; //[cite: 1]
            if ((status === 503 || status === 429) && attempt < MAX_RETRIES) { //[cite: 1]
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; //[cite: 1]
                console.warn(`⚠️ Gemini surchargé (Erreur ${status}). Nouvelle tentative dans ${Math.round(delay)}ms... (Essai ${attempt}/${MAX_RETRIES})`); //[cite: 1]
                await sleep(delay); //[cite: 1]
            } else {
                console.warn(`❌ Échec Gemini Clé Principale (Erreur: ${status || error.message}).`); //[cite: 1]
                break; //[cite: 1]
            }
        }
    }

    // 2. PLAN B : TENTATIVE AVEC CLÉ DE SECOURS
    if (process.env.GEMINI_API_KEY_BACKUP) { //[cite: 1]
        console.log("🔄 Basculement sur la clé Gemini de secours (Plan B)..."); //[cite: 1]
        try {
            return await callGeminiAPI(backupKey, promptText, expectJson);
        } catch (backupError) {
            console.error("❌ Échec également sur la clé Gemini de secours:", backupError.message); //[cite: 1]
        }
    }

    throw new Error("Échec total de l'appel Gemini (Toutes les tentatives ont échoué)."); //[cite: 1]
}

// ==========================================
// APPEL BRUT À L'API GEMINI
// ==========================================
async function callGeminiAPI(key, promptText, expectJson) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`; //[cite: 1]
    
    const response = await axios.post(url, { //[cite: 1]
        contents: [{ parts: [{ text: promptText }] }], //[cite: 1]
        generationConfig: {
            temperature: 1.0,  //[cite: 1]
            topP: 0.95,        //[cite: 1]
            topK: 40           //[cite: 1]
        }
    });

    const rawText = response.data.candidates[0].content.parts[0].text; //[cite: 1]
    
    if (expectJson) {
        const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim(); //[cite: 1]
        return JSON.parse(jsonStr); //[cite: 1]
    }
    
    return rawText.trim();
}

module.exports = { generateStory }; //[cite: 1]