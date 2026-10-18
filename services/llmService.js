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
// SÉLECTION DYNAMIQUE DES MODÈLES GEMINI
// ==========================================
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_MODELS = 5;          // nombre max de modèles essayés par clé
const MAX_RETRIES = 3;         // essais par modèle
const MODELS_CACHE_TTL = 60 * 60 * 1000; // 1 h

// Dernier recours si l'API de liste des modèles est indisponible
const LAST_RESORT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

// Cache par clé : { models, expires }
const modelsCache = new Map();

// Extrait le numéro de version d'un nom de modèle (ex: "gemini-2.5-flash" -> 2.5)
const modelVersion = (name) => parseFloat(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || 0);

async function pickModels(key) {
    const cached = modelsCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.models;

    const found = [];
    try {
        const response = await axios.get(`${GEMINI_BASE_URL}/models`, {
            params: { pageSize: 200, key }
        });
        for (const m of response.data.models || []) {
            const name = m.name.replace('models/', '');
            if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
            // Uniquement les modèles "flash" de texte, hors variantes spécialisées/expérimentales
            if (!/flash/.test(name) || /image|tts|live|audio|embed|robotics|computer|exp|latest/.test(name)) continue;
            found.push(name);
        }
    } catch (error) {
        console.warn(`⚠️ Liste des modèles Gemini indisponible (${error.response?.status || error.message}).`);
    }

    // Plus récent d'abord ; les versions "lite" passent après les modèles normaux de même version
    found.sort((x, y) =>
        modelVersion(y) - modelVersion(x) ||
        /lite/.test(x) - /lite/.test(y) ||
        x.length - y.length
    );

    // Un modèle imposé via GEMINI_MODEL est toujours essayé en premier
    const models = [process.env.GEMINI_MODEL, ...found]
        .filter(Boolean)
        .filter((m, i, arr) => arr.indexOf(m) === i)
        .slice(0, MAX_MODELS);

    // Si la liste est vide (API injoignable), on se rabat sur les modèles de dernier recours
    const result = models.length ? models : LAST_RESORT_MODELS;

    // On ne met en cache que les listes obtenues réellement depuis l'API
    if (found.length) {
        modelsCache.set(key, { models: result, expires: Date.now() + MODELS_CACHE_TTL });
    }

    console.log('Modèles Gemini à essayer :', result.join(', '));
    return result;
}

// ==========================================
// MOTEUR D'EXÉCUTION ET DE GESTION D'ERREURS
// ==========================================
async function executeGeminiCall(promptText, expectJson = true) {
    const primaryKey = process.env.GEMINI_API_KEY;
    const backupKey = process.env.GEMINI_API_KEY_BACKUP;

    // Clés à essayer dans l'ordre (la clé de secours uniquement si elle est différente)
    const keys = [
        { label: 'principale', value: primaryKey },
        ...(backupKey && backupKey !== primaryKey ? [{ label: 'de secours', value: backupKey }] : [])
    ].filter(k => k.value);

    for (const { label, value: key } of keys) {
        console.log(`🔑 Utilisation de la clé Gemini ${label}...`);
        const result = await tryAllModels(key, promptText, expectJson);
        if (result !== undefined) return result;
        console.warn(`❌ Échec de la clé Gemini ${label}.`);
    }

    throw new Error("Échec total de l'appel Gemini (Toutes les clés et tous les modèles ont échoué).");
}

// Essaie chaque modèle (avec retries) pour une clé donnée. Renvoie undefined en cas d'échec total.
async function tryAllModels(key, promptText, expectJson) {
    const models = await pickModels(key);

    for (const model of models) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                return await callGeminiAPI(key, model, promptText, expectJson);
            } catch (error) {
                const status = error.response?.status ?? null;
                const reason = status || error.message;

                // Clé refusée : inutile d'essayer d'autres modèles avec cette clé
                if (status === 401 || status === 403) {
                    console.warn(`🚫 [${model}] Clé refusée (HTTP ${status}).`);
                    return undefined;
                }

                // Modèle indisponible ou requête invalide : on passe au modèle suivant
                if (status === 400 || status === 404) {
                    console.warn(`⚠️ [${model}] Indisponible (HTTP ${status}). Passage au modèle suivant.`);
                    break;
                }

                // Erreurs transitoires (429, 5xx, réseau, JSON invalide) : retry avec backoff
                if (attempt < MAX_RETRIES) {
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    console.warn(`⚠️ [${model}] Erreur (${reason}). Nouvelle tentative dans ${Math.round(delay)}ms... (Essai ${attempt}/${MAX_RETRIES})`);
                    await sleep(delay);
                } else {
                    console.warn(`⚠️ [${model}] Échec après ${MAX_RETRIES} essais (${reason}). Passage au modèle suivant.`);
                }
            }
        }
    }

    return undefined;
}

// ==========================================
// APPEL BRUT À L'API GEMINI
// ==========================================
async function callGeminiAPI(key, model, promptText, expectJson) {
    const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${key}`;

    const generationConfig = {
        temperature: 1.0,
        topP: 0.95,
        topK: 40
    };
    // Force une sortie JSON valide côté Gemini quand on en attend une
    if (expectJson) generationConfig.responseMimeType = 'application/json';

    const response = await axios.post(url, {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig
    });

    // On ignore les "thought parts" des modèles à raisonnement
    const rawText = response.data.candidates?.[0]?.content?.parts
        ?.filter(p => !p.thought)
        .map(p => p.text)
        .join('');

    if (!rawText) {
        const reason = response.data.promptFeedback?.blockReason || response.data.candidates?.[0]?.finishReason || 'réponse vide';
        throw new Error(`Réponse Gemini inexploitable (${reason}).`);
    }

    // Si on s'attend à du JSON, on nettoie et on parse. Sinon, on renvoie le texte brut.
    if (expectJson) {
        const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr); // une SyntaxError déclenche un nouvel essai
    }

    return rawText.trim();
}

module.exports = { generateStory };