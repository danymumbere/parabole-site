const { HfInference } = require('@huggingface/inference');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios');

// Utilise la clé API Hugging Face (Plan de secours)
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

async function generateImage(prompt, referenceImageUrl = null) {
    const styleModifier = "full frame composition, wide angle, broad camera perspective, no close-ups, modern minimalist graphic design, 2D flat illustration, not 3D, 16:9 aspect ratio";
    let finalPrompt = `${prompt}, ${styleModifier}`;

    // ==========================================
    // PLAN A : Pollinations.ai Image (Priorité)
    // ==========================================
    try {
        console.log("Tentative de génération d'image via Pollinations.ai (Plan A)...");
        
        if (referenceImageUrl) {
            console.log("Note : L'image de référence est ignorée par Pollinations pour éviter la génération de texte parasite.");
        }
        
        const encodedPrompt = encodeURIComponent(finalPrompt); 
        const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
        
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        console.log("✅ Image générée avec succès via Pollinations.ai !");
        
        return await saveImageFile(response.data);

    } catch (error) {
        console.warn(`⚠️ Pollinations.ai indisponible (${error.message}). Basculement sur Hugging Face (Plan B)...`);
        
        // ==========================================
        // PLAN B : Hugging Face SDXL (Secours)
        // ==========================================
        try {
            console.log("Tentative de génération via Hugging Face (Inference API)...");
            
            const blob = await hf.textToImage({
                inputs: finalPrompt,
                model: 'stabilityai/stable-diffusion-xl-base-1.0', 
                parameters: { num_inference_steps: 30 }
            });

            const buffer = Buffer.from(await blob.arrayBuffer());
            console.log("✅ Image générée avec succès via Hugging Face !");
            
            return await saveImageFile(buffer);
            
        } catch (fallbackError) {
            console.error("❌ Erreur critique Hugging Face:", fallbackError.message);
            throw new Error(`Échec total de la génération d'image (Pollinations et Hugging Face inaccessibles ou quotas atteints).`);
        }
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