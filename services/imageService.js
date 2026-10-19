const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios');

const POLLINATIONS_BASE_URL = 'https://gen.pollinations.ai';

const MAX_MODELS = 5;                       // nombre max de modèles essayés par génération
const MODELS_CACHE_TTL = 60 * 60 * 1000;    // 1 h

// Dernier recours UNIQUEMENT si le catalogue /image/models est injoignable
const LAST_RESORT_MODELS = [
    'black-forest-labs/flux.1-schnell',
    'tongyi-mai/z-image-turbo',
    'flux'
];

// Classement "par performance" (heuristique, le catalogue ne fournit pas de score de qualité).
// Plus un motif est haut dans la liste, plus le modèle est prioritaire.
const QUALITY_PATTERNS = [
    /flux-3-image(?!-klein)/, /flux\.2-(max|pro|flex)/, /gpt-image-2/, /seedream-5\.0-pro/,
    /ideogram-v4/, /nano-banana|gemini-3.*image/, /qwen-image-3/, /seedream/,
    /flux\.1\.1-pro/, /gpt-image/, /qwen-image/, /mai-image/, /wan-2\.7-image/,
    /flux\.2/, /grok-imagine-image/, /krea/, /z-image/, /flux\.1/, /dreamshaper/
];
// Variantes rapides/allégées : légèrement moins bien classées que leur famille
const LIGHT_VARIANT = /turbo|lite|mini|klein|schnell|flash|lcm|fast/;

// Cache du catalogue : { models, expires }
let catalogCache = null;

// Fonction utilitaire de temporisation
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==========================================
// DÉCOUVERTE DES MODÈLES (catalogue /image/models)
// ==========================================

// Récupère récursivement toutes les valeurs numériques d'un objet "pricing"
function collectNumbers(value, out = []) {
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
    else if (Array.isArray(value)) value.forEach(v => collectNumbers(v, out));
    else if (value && typeof value === 'object') Object.values(value).forEach(v => collectNumbers(v, out));
    return out;
}

// Gratuit = pas "paid_only" + tarification connue dont toutes les valeurs sont à 0.
// (Tarification absente/illisible = inconnu = considéré comme NON gratuit, par prudence.)
function isFreeModel(model) {
    if (model.paid_only === true) return false;
    const prices = collectNumbers(model.pricing);
    return prices.length > 0 && prices.every(p => p === 0);
}

// Coût approximatif (somme des tarifs) pour trier les modèles payants du moins cher au plus cher
function approxCost(model) {
    return collectNumbers(model.pricing).reduce((a, b) => a + b, 0);
}

// Garde uniquement les modèles texte -> image raster (pas vidéo, pas édition, pas vectoriel)
function isUsableImageModel(model) {
    const id = String(model.name || model.id || '');
    if (!id) return false;
    const outputs = model.output_modalities || ['image'];
    const inputs = model.input_modalities || ['text'];
    if (!outputs.includes('image') || outputs.includes('video')) return false;
    if (!inputs.includes('text')) return false;
    if (/edit|kontext|vector|video/i.test(id)) return false;
    return true;
}

function qualityScore(id) {
    const idx = QUALITY_PATTERNS.findIndex(re => re.test(id));
    const base = idx === -1 ? QUALITY_PATTERNS.length : idx;
    return base * 10 + (LIGHT_VARIANT.test(id) ? 5 : 0); // plus petit = meilleur
}

async function fetchImageCatalog(headers) {
    if (catalogCache && catalogCache.expires > Date.now()) return catalogCache.models;

    const response = await axios.get(`${POLLINATIONS_BASE_URL}/image/models`, { headers, timeout: 10000 });
    const raw = response.data;
    const list = Array.isArray(raw) ? raw : (raw?.data || raw?.models || []);

    const models = list.filter(isUsableImageModel);
    if (!models.length) throw new Error('Catalogue vide ou format inattendu');

    catalogCache = { models, expires: Date.now() + MODELS_CACHE_TTL };
    return models;
}

// Construit la liste ordonnée des modèles à essayer
async function pickModels(headers) {
    const forced = [process.env.POLLINATIONS_IMAGE_MODEL].filter(Boolean);
    let ranked = [];

    try {
        const catalog = await fetchImageCatalog(headers);
        const free = catalog.filter(isFreeModel).sort((a, b) =>
            qualityScore(a.name || a.id) - qualityScore(b.name || b.id) || String(a.name).localeCompare(String(b.name))
        );

        if (free.length) {
            ranked = free.map(m => m.name || m.id);
            console.log(`🆓 ${free.length} modèle(s) gratuit(s) détecté(s) : ${ranked.slice(0, MAX_MODELS).join(', ')}`);
        } else if (process.env.POLLINATIONS_ALLOW_PAID === 'true') {
            // Option : si aucun modèle gratuit, on tente les moins chers (consomme du Pollen)
            ranked = [...catalog].sort((a, b) => approxCost(a) - approxCost(b) || qualityScore(a.name) - qualityScore(b.name)).map(m => m.name || m.id);
            console.warn(`⚠️ Aucun modèle gratuit : repli sur les moins chers (POLLINATIONS_ALLOW_PAID=true) : ${ranked.slice(0, MAX_MODELS).join(', ')}`);
        } else {
            const cheapest = [...catalog].sort((a, b) => approxCost(a) - approxCost(b)).slice(0, 3).map(m => m.name || m.id);
            console.warn(`⚠️ Aucun modèle gratuit dans le catalogue Pollinations. Les moins chers : ${cheapest.join(', ')}. Mettez POLLINATIONS_ALLOW_PAID=true pour les autoriser.`);
        }
    } catch (error) {
        console.warn(`⚠️ Catalogue /image/models indisponible (${error.response?.status || error.message}). Utilisation des modèles de dernier recours.`);
        ranked = LAST_RESORT_MODELS;
    }

    return [...forced, ...ranked].filter((m, i, arr) => arr.indexOf(m) === i).slice(0, MAX_MODELS);
}

// ==========================================
// REQUÊTES ET UTILITAIRES
// ==========================================

// Avec responseType 'arraybuffer', le corps d'erreur est un Buffer : on le décode pour le log
function extractErrorMessage(error) {
    const data = error.response?.data;
    if (!data) return error.message;
    try {
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : (typeof data === 'string' ? data : JSON.stringify(data));
        const parsed = JSON.parse(text);
        return parsed?.error?.message || text.slice(0, 300);
    } catch {
        return (Buffer.isBuffer(data) ? data.toString('utf8') : String(data)).slice(0, 300);
    }
}

// Helper de requête HTTP avec gestion du Rate Limit (429) et retry exponentiel
// NB : un 402 (solde Pollen insuffisant) n'est volontairement PAS réessayé.
async function fetchWithRetry(url, options = {}, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await axios.get(url, options);
        } catch (error) {
            const status = error.response?.status;
            const isRateLimit = status === 429;
            const isServerError = status >= 500;
            const isNetworkError = !error.response;

            if ((isRateLimit || isServerError || isNetworkError) && i < retries - 1) {
                console.warn(`⚠️ Erreur ${status || error.message} (Rate Limit / Serveur / Réseau). Nouvelle tentative (${i + 1}/${retries}) dans ${delay / 1000}s...`);
                await sleep(delay);
                delay *= 2;
            } else {
                throw error;
            }
        }
    }
}

// Diagnostic : solde Pollen visible par la clé (utile pour comprendre un 402)
async function logPollenBalance(headers) {
    try {
        const res = await axios.get(`${POLLINATIONS_BASE_URL}/account/balance`, { headers, timeout: 8000 });
        console.warn(`ℹ️ Solde Pollen visible par la clé : ${JSON.stringify(res.data)}`);
    } catch (e) {
        console.warn(`ℹ️ Solde Pollen indisponible (${e.response?.status || e.message}).`);
    }
}

// Extension réelle selon le type de contenu renvoyé (JPEG, PNG ou SVG selon le modèle)
function extensionFromContentType(contentType = '') {
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
    if (contentType.includes('svg')) return 'svg';
    if (contentType.includes('webp')) return 'webp';
    return 'png';
}

// ==========================================
// GÉNÉRATION
// ==========================================
async function generateImage(prompt, referenceImageUrl = null) {
    // Renforcement strict du style 2D pour empêcher le rendu 3D
    const styleModifier = "strict 2D vector art, completely flat illustration, minimalist graphic design, solid colors, no shading, zero 3D rendering, no gradients, 16:9 aspect ratio";
    const finalPrompt = `${prompt}, ${styleModifier}`;

    if (referenceImageUrl) {
        console.log("Note : L'image de référence est ignorée par Pollinations pour éviter la génération de texte parasite.");
    }

    const encodedPrompt = encodeURIComponent(finalPrompt);

    const headers = {};
    if (process.env.POLLINATIONS_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
    }

    const models = await pickModels(headers);
    if (!models.length) {
        throw new Error("Échec de la génération d'image : aucun modèle Pollinations gratuit disponible.");
    }
    console.log(`Génération d'image via Pollinations.ai (modèles : ${models.join(', ')})...`);

    let lastError = null;
    let paymentRequired = false;

    for (const model of models) {
        try {
            const seed = Math.floor(Math.random() * 10000);
            const url = `${POLLINATIONS_BASE_URL}/image/${encodedPrompt}?model=${encodeURIComponent(model)}&width=1024&height=576&nologo=true&seed=${seed}`;

            console.log(`→ Essai avec le modèle ${model}...`);
            const response = await fetchWithRetry(url, { responseType: 'arraybuffer', headers });

            console.log(`✅ Image générée avec succès via Pollinations.ai (${model}) !`);
            return await saveImageFile(response.data, extensionFromContentType(response.headers?.['content-type']));

        } catch (error) {
            lastError = error;
            const status = error.response?.status;
            const detail = extractErrorMessage(error);

            if (status === 401 || status === 403) {
                console.error(`❌ Pollinations : clé API refusée (HTTP ${status}) : ${detail}`);
                throw new Error(`Échec de la génération d'image : clé Pollinations invalide ou sans permission (HTTP ${status}).`);
            }

            if (status === 402) {
                paymentRequired = true;
                console.warn(`⚠️ [${model}] HTTP 402 (solde Pollen insuffisant) : ${detail}. Essai du modèle suivant...`);
                continue;
            }

            console.warn(`⚠️ [${model}] Échec (HTTP ${status || error.message}) : ${detail}. Essai du modèle suivant...`);
        }
    }

    if (paymentRequired) {
        catalogCache = null; // force un rafraîchissement du catalogue au prochain appel
        await logPollenBalance(headers);
        throw new Error("Échec de la génération d'image : solde Pollen insuffisant (HTTP 402). Vérifiez le solde et le budget de la clé sur enter.pollinations.ai.");
    }

    console.error("❌ Erreur Pollinations:", lastError?.message);
    throw new Error("Échec de la génération d'image via Pollinations.ai.");
}

// Fonction utilitaire pour sauvegarder le fichier
async function saveImageFile(buffer, extension = 'png') {
    const fileName = `image_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
    const imagePath = path.join(os.tmpdir(), fileName);

    await fs.writeFile(imagePath, buffer);
    console.log(`✅ Image prête : ${imagePath}`);
    return imagePath;
}

module.exports = { generateImage };