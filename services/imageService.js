const { HfInference } = require('@huggingface/inference');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios');

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// Variable en mémoire pour suivre le blocage mensuel de Hugging Face
let hfBlockedMonth = -1;

// Fonction utilitaire de temporisation
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper de requête HTTP avec gestion du Rate Limit (429) et retry exponentiel
async function fetchWithRetry(url, options = {}, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await axios.get(url, options);
        } catch (error) {
            const status = error.response?.status;
            const isRateLimit = status === 429;
            const isServerError = status >= 500;

            if ((isRateLimit || isServerError) && i < retries - 1) {
                console.warn(`⚠️ Erreur HTTP ${status} (Rate Limit / Serveur). Nouvelle tentative (${i + 1}/${retries}) dans ${delay / 1000}s...`);
                await sleep(delay);
                delay *= 2; // Doubler le délai d'attente (backoff exponentiel)
            } else {
                throw error;
            }
        }
    }
}

async function generateImage(prompt, referenceImageUrl = null) {
    // Renforcement strict du style 2D pour empêcher le rendu 3D
    const styleModifier = "strict 2D vector art, completely flat illustration, minimalist graphic design, solid colors, no shading, zero 3D rendering, no gradients, 16:9 aspect ratio";
    let finalPrompt = `${prompt}, ${styleModifier}`;
    
    const currentMonth = new Date().getMonth();
    
    // ==========================================
    // PLAN A : Hugging Face SDXL (Priorité Qualité)
    // ==========================================
    if (hfBlockedMonth !== currentMonth) {
        try {
            console.log("Tentative de génération via Hugging Face (Plan A)...");
            
            const blob = await hf.textToImage({
                inputs: finalPrompt,
                model: 'stabilityai/stable-diffusion-xl-base-1.0', 
                parameters: { num_inference_steps: 30 }
            });

            const buffer = Buffer.from(await blob.arrayBuffer());
            console.log("✅ Image générée avec succès via Hugging Face !");
            
            return await saveImageFile(buffer);
            
        } catch (error) {
            console.warn(`⚠️ Échec Hugging Face (${error.message}). Basculement et blocage pour le mois en cours.`);
            hfBlockedMonth = currentMonth;
        }
    } else {
        console.log("ℹ️ Hugging Face est bloqué pour ce mois. Passage direct au Plan B.");
    }

    // ==========================================
    // PLAN B : Pollinations.ai (Nouvelle API gen.pollinations.ai)
    // ==========================================
    try {
        console.log("Tentative de génération d'image via Pollinations.ai...");
        
        if (referenceImageUrl) {
            console.log("Note : L'image de référence est ignorée par Pollinations pour éviter la génération de texte parasite.");
        }
        
        const encodedPrompt = encodeURIComponent(finalPrompt); 
        const seed = Math.floor(Math.random() * 10000);
        
        // Mise à jour de l'URL vers le nouveau point d'entrée unifié de Pollinations AI
        const url = `https://gen.pollinations.ai/image/${encodedPrompt}?width=1024&height=576&nologo=true&seed=${seed}&model=flux`;
        
        // Ajout de l'en-tête d'authentification requis si la clé est configurée
        const headers = {};
        if (process.env.POLLINATIONS_API_KEY) {
            headers['Authorization'] = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
        }

        // Requête HTTP sécurisée avec retries automatiques
        const response = await fetchWithRetry(url, { 
            responseType: 'arraybuffer',
            headers: headers
        });

        console.log("✅ Image générée avec succès via Pollinations.ai !");
        
        return await saveImageFile(response.data);

    } catch (fallbackError) {
        console.error("❌ Erreur critique Pollinations:", fallbackError.message);
        throw new Error(`Échec total de la génération d'image (Hugging Face et Pollinations inaccessibles).`);
    }
}

// Fonction utilitaire pour sauvegarder le fichier
async function saveImageFile(buffer) {
    const fileName = `image_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`;
    const imagePath = path.join(os.tmpdir(), fileName);

    await fs.writeFile(imagePath, buffer);
    console.log(`✅ Image prête : ${imagePath}`);
    return imagePath;
}

module.exports = { generateImage };