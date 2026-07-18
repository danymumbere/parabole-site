const { HfInference } = require('@huggingface/inference');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios');

// Utilise la clé API Hugging Face (à configurer dans votre environnement)
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// Paramètre optionnel "referenceImageUrl"
async function generateImage(prompt, referenceImageUrl = null) {
    // Maintien d'un cadrage large et aéré sans gros plans
    const styleModifier = "full frame composition, wide angle, broad camera perspective, no close-ups, modern minimalist graphic design, 2D flat illustration, not 3D, 16:9 aspect ratio";
    let finalPrompt = `${prompt}, ${styleModifier}`;

    try {
        console.log("Tentative de génération via les serveurs Hugging Face (Inference API)...");
        
        const blob = await hf.textToImage({
            inputs: finalPrompt,
            model: 'stabilityai/stable-diffusion-xl-base-1.0', 
            parameters: { num_inference_steps: 30 }
        });

        // Le "await" est bien présent, la conversion en Buffer se fera parfaitement
        const buffer = Buffer.from(await blob.arrayBuffer());
        return await saveImageFile(buffer);

    } catch (error) {
        console.warn(`⚠️ Hugging Face indisponible ou limite atteinte (${error.message}). Basculement sur Pollinations.ai...`);
        
        try {
            // CORRECTION : Pollinations est un modèle Texte-vers-Image pur.
            // On ne lui passe pas l'URL de référence pour ne pas polluer le texte.
            if (referenceImageUrl) {
                console.log("Note : L'image de référence est ignorée par Pollinations pour éviter la génération de texte parasite.");
            }
            
            const encodedPrompt = encodeURIComponent(finalPrompt); 
            const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
            
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            return await saveImageFile(response.data);
            
        } catch (fallbackError) {
            console.error("❌ Erreur critique Pollinations:", fallbackError.message);
            throw new Error(`Échec total de la génération d'image.`);
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