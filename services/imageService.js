const { HfInference } = require('@huggingface/inference');
const fs = require('fs').promises; 
const path = require('path');
const os = require('os');
const axios = require('axios'); // Nécessaire pour faire la requête vers Pollinations

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// On ajoute un paramètre optionnel "referenceImageUrl"
async function generateImage(prompt, referenceImageUrl = null) {
    const styleModifier = "full frame composition, modern minimalist graphic design, 2D flat illustration, not 3D, 16:9 aspect ratio";
    let finalPrompt = `${prompt}, ${styleModifier}`;

    try {
        console.log("Tentative de génération avec Hugging Face...");
        const blob = await hf.textToImage({
            inputs: finalPrompt,
            model: 'black-forest-labs/FLUX.1-schnell',
            parameters: { num_inference_steps: 4 }
        });

        const buffer = Buffer.from(await blob.arrayBuffer());
        return await saveImageFile(buffer);

    } catch (error) {
        console.warn(`⚠️ Hugging Face indisponible (${error.message}). Basculement sur Pollinations.ai...`);
        
        try {
            // Si une URL Cloudinary est fournie, on l'ajoute au début du prompt pour Pollinations
            if (referenceImageUrl) {
                console.log("Utilisation d'une image de référence pour la consistance...");
                finalPrompt = `${referenceImageUrl} ${finalPrompt}`;
            }
            
            const encodedPrompt = encodeURIComponent(finalPrompt);
            // nologo=true enlève la marque d'eau, et le seed aléatoire empêche le cache
            const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
            
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            return await saveImageFile(response.data);
            
        } catch (fallbackError) {
            console.error("❌ Erreur critique Pollinations:", fallbackError.message);
            throw new Error(`Échec total de la génération d'image.`);
        }
    }
}

// Fonction utilitaire pour sauvegarder le fichier (pour ne pas écrire le code en double)
async function saveImageFile(buffer) {
    const fileName = `image_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`;
    const imagePath = path.join(os.tmpdir(), fileName); 
    await fs.writeFile(imagePath, buffer);
    console.log(`✅ Image prête : ${imagePath}`);
    return imagePath; 
}

module.exports = { generateImage };