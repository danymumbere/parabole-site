const { HfInference } = require('@huggingface/inference');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios');

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// Variable en mémoire pour suivre le blocage mensuel
let hfBlockedMonth = -1;

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
            // On verrouille Hugging Face jusqu'au mois prochain
            hfBlockedMonth = currentMonth;
        }
    } else {
        console.log("ℹ️ Hugging Face est bloqué pour ce mois. Passage direct au Plan B.");
    }

    // ==========================================
    // PLAN B : Pollinations.ai (Secours illimité)
    // ==========================================
    try {
        console.log("Tentative de génération d'image via Pollinations.ai...");
        
        if (referenceImageUrl) {
            console.log("Note : L'image de référence est ignorée par Pollinations pour éviter la génération de texte parasite.");
        }
        
        const encodedPrompt = encodeURIComponent(finalPrompt); 
        const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
        
        const response = await axios.get(url, { responseType: 'arraybuffer' });
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