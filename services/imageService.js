const { HfInference } = require('@huggingface/inference');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios');

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// Variable en mémoire pour enregistrer le mois où Hugging Face est tombé en panne de crédits
let hfDisabledMonth = null;

async function generateImage(prompt, referenceImageUrl = null) {
    const currentMonth = new Date().getMonth(); // 0 (Janvier) à 11 (Décembre)
    
    // Style renforcé pour verrouiller le rendu 2D flat illustration et bannir le rendu 3D
    const styleModifier = "2D flat vector illustration, modern minimalist graphic design, clean lines, flat solid colors, no 3D render, no ambient occlusion, wide angle, 16:9 aspect ratio";
    let finalPrompt = `${prompt}, ${styleModifier}`;

    // Vérification : Hugging Face est-il bloqué pour le mois en cours ?
    const isHfDisabledThisMonth = (hfDisabledMonth === currentMonth);

    if (!isHfDisabledThisMonth) {
        // ====================================================
        // CONFIGURATION NORMALE : HF (Plan A) | Pollinations (Plan B)
        // ====================================================
        try {
            console.log("Tentative de génération d'image via Hugging Face SDXL (Plan A)...");
            return await generateWithHuggingFace(finalPrompt);

        } catch (error) {
            console.warn(`⚠️ Hugging Face indisponible ou quota dépassé (${error.message}).`);
            console.warn(`🔒 Hugging Face désactivé pour le reste du mois en cours.`);
            
            // On enregistre l'index du mois actuel
            hfDisabledMonth = currentMonth;

            console.log("🔄 Basculement immédiat sur Pollinations.ai (Plan B)...");
            return await generateWithPollinations(finalPrompt);
        }
    } else {
        // ====================================================
        // CONFIGURATION INVERSÉE : Pollinations (Plan A) | HF (Plan B)
        // ====================================================
        try {
            console.log("Tentative via Pollinations.ai (Prioritaire ce mois-ci suite au quota HF)...");
            return await generateWithPollinations(finalPrompt);

        } catch (error) {
            console.warn(`⚠️ Pollinations.ai indisponible (${error.message}). Tentative de secours Hugging Face...`);
            try {
                return await generateWithHuggingFace(finalPrompt);
            } catch (fallbackError) {
                console.error("❌ Erreur critique Hugging Face:", fallbackError.message);
                throw new Error("Échec total de la génération d'image (Pollinations et Hugging Face inaccessibles).");
            }
        }
    }
}

// Fonction d'appel à Hugging Face
async function generateWithHuggingFace(finalPrompt) {
    const blob = await hf.textToImage({
        inputs: finalPrompt,
        model: 'stabilityai/stable-diffusion-xl-base-1.0',
        parameters: { num_inference_steps: 30 }
    });
    const buffer = Buffer.from(await blob.arrayBuffer());
    console.log("✅ Image générée avec succès via Hugging Face !");
    return await saveImageFile(buffer);
}

// Fonction d'appel à Pollinations.ai
async function generateWithPollinations(finalPrompt) {
    const encodedPrompt = encodeURIComponent(finalPrompt);
    // Utilisation du modèle flux pour un meilleur respect des prompts négatifs/style
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&nologo=true&seed=${Math.floor(Math.random() * 10000)}&model=flux`;
    
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    console.log("✅ Image générée avec succès via Pollinations.ai !");
    return await saveImageFile(response.data);
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