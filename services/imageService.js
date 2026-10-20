const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios');

// ==========================================
// CONFIGURATION (variables d'environnement)
// ==========================================
// CLOUDFLARE_ACCOUNT_ID  : ID du compte Cloudflare
// CLOUDFLARE_API_TOKEN   : jeton API avec la permission Workers AI
// CLOUDFLARE_IMAGE_MODELS: (optionnel) modèles à essayer dans l'ordre, séparés par des virgules

// Modèles essayés dans l'ordre. Le premier est le plus qualitatif ; le second respecte mieux le format 16:9.
const DEFAULT_IMAGE_MODELS = [
    '@cf/black-forest-labs/flux-1-schnell',
    '@cf/bytedance/stable-diffusion-xl-lightning'
];

const WIDTH = 1024;
const HEIGHT = 576; // 16:9

function getModels() {
    const fromEnv = (process.env.CLOUDFLARE_IMAGE_MODELS || '')
        .split(',')
        .map(m => m.trim())
        .filter(Boolean);
    return fromEnv.length ? fromEnv : DEFAULT_IMAGE_MODELS;
}

// Fonction utilitaire de temporisation
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==========================================
// UTILITAIRES
// ==========================================

// Le corps d'erreur peut arriver sous forme de Buffer (responseType 'arraybuffer') : on le décode pour le log
function extractErrorMessage(error) {
    const data = error.response?.data;
    if (!data) return error.message;
    try {
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : (typeof data === 'string' ? data : JSON.stringify(data));
        const parsed = JSON.parse(text);
        const first = parsed?.errors?.[0];
        return first ? `${first.code ? first.code + ': ' : ''}${first.message}` : text.slice(0, 300);
    } catch {
        return (Buffer.isBuffer(data) ? data.toString('utf8') : String(data)).slice(0, 300);
    }
}

// Détecte le format réel de l'image grâce aux premiers octets (JPEG, PNG ou WebP)
function detectExtension(buffer) {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'jpg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
    if (buffer.slice(0, 4).toString() === 'RIFF') return 'webp';
    return 'png';
}

// Selon le modèle, Cloudflare renvoie soit du JSON {result:{image:"<base64>"}} (FLUX), soit l'image brute (SDXL)
function extractImageBuffer(response) {
    const contentType = String(response.headers?.['content-type'] || '');
    const raw = Buffer.from(response.data);

    if (contentType.includes('application/json')) {
        const json = JSON.parse(raw.toString('utf8'));
        if (json.success === false) {
            throw Object.assign(new Error(json.errors?.[0]?.message || 'Réponse Cloudflare en échec'), { cfJson: json });
        }
        const b64 = json?.result?.image;
        if (!b64) throw new Error('Réponse Cloudflare sans image');
        return Buffer.from(b64, 'base64');
    }
    return raw; // image binaire directe
}

// Appel brut à un modèle Cloudflare Workers AI
async function callCloudflare(model, prompt, withDimensions) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

    const body = { prompt };
    if (withDimensions) {
        body.width = WIDTH;
        body.height = HEIGHT;
    }

    const response = await axios.post(url, body, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: 90000
    });

    return extractImageBuffer(response);
}

// ==========================================
// GÉNÉRATION
// ==========================================
async function generateImage(prompt, referenceImageUrl = null) {
    if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
        throw new Error("Échec de la génération d'image : CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN doivent être configurés.");
    }

    // Renforcement strict du style 2D pour empêcher le rendu 3D
    const styleModifier = "strict 2D vector art, completely flat illustration, minimalist graphic design, solid colors, no shading, zero 3D rendering, no gradients, 16:9 aspect ratio";
    // Limite de 2048 caractères pour le prompt côté Cloudflare
    const finalPrompt = `${prompt}, ${styleModifier}`.slice(0, 2048);

    if (referenceImageUrl) {
        console.log("Note : L'image de référence est ignorée pour éviter la génération de texte parasite.");
    }

    const models = getModels();
    const MAX_RETRIES = 3;
    let lastError = null;

    console.log(`Génération d'image via Cloudflare Workers AI (modèles : ${models.join(', ')})...`);

    for (const model of models) {
        let withDimensions = true;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`→ Essai avec ${model} (essai ${attempt}/${MAX_RETRIES})...`);
                const buffer = await callCloudflare(model, finalPrompt, withDimensions);

                console.log(`✅ Image générée avec succès via ${model} !`);
                return await saveImageFile(buffer, detectExtension(buffer));

            } catch (error) {
                lastError = error;
                const status = error.response?.status;
                const detail = extractErrorMessage(error);

                // Jeton ou compte invalide : inutile de continuer
                if (status === 401 || status === 403) {
                    console.error(`❌ Cloudflare : accès refusé (HTTP ${status}) : ${detail}`);
                    throw new Error(`Échec de la génération d'image : jeton ou identifiant de compte Cloudflare invalide (HTTP ${status}).`);
                }

                // Quota gratuit quotidien épuisé : inutile de réessayer avant la réinitialisation (00:00 UTC)
                if (/neuron|daily|allocation|quota/i.test(detail)) {
                    console.error(`❌ Cloudflare : quota gratuit quotidien probablement épuisé : ${detail}`);
                    throw new Error("Échec de la génération d'image : quota gratuit quotidien Cloudflare épuisé (réinitialisation à 00:00 UTC).");
                }

                // Paramètres width/height refusés par ce modèle : on réessaie sans
                if (status === 400 && withDimensions) {
                    console.warn(`⚠️ [${model}] Requête refusée avec width/height (${detail}). Nouvel essai sans dimensions.`);
                    withDimensions = false;
                    attempt--; // cet essai ne compte pas
                    continue;
                }

                // Modèle inexistant ou non autorisé : modèle suivant
                if (status === 400 || status === 404) {
                    console.warn(`⚠️ [${model}] Indisponible (HTTP ${status}) : ${detail}. Passage au modèle suivant.`);
                    break;
                }

                // Erreurs transitoires (429, 5xx, réseau, réponse invalide) : retry avec backoff
                if (attempt < MAX_RETRIES) {
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    console.warn(`⚠️ [${model}] Erreur (${status || detail}). Nouvelle tentative dans ${Math.round(delay)}ms...`);
                    await sleep(delay);
                } else {
                    console.warn(`⚠️ [${model}] Échec après ${MAX_RETRIES} essais (${status || detail}). Passage au modèle suivant.`);
                }
            }
        }
    }

    console.error("❌ Erreur Cloudflare:", lastError?.message);
    throw new Error("Échec de la génération d'image via Cloudflare Workers AI.");
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