const { HfInference } = require('@huggingface/inference');
const fs = require('fs').promises; 
const path = require('path');
const os = require('os');

// Initialisation du client officiel avec ta clé API
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

async function generateImage(prompt) {
    const styleModifier = "full frame composition, modern minimalist graphic design, 2D flat illustration, not 3D, 16:9 aspect ratio";
    const finalPrompt = `${prompt}, ${styleModifier}`;

    try {
        // Le SDK gère les URL et trouve automatiquement un fournisseur actif
        const blob = await hf.textToImage({
            inputs: finalPrompt,
            model: 'black-forest-labs/FLUX.1-schnell',
            parameters: {
                num_inference_steps: 4 // FLUX.1-schnell est optimisé pour 4 étapes
            }
        });

        // Conversion de la réponse (Blob) en fichier exploitable (Buffer)
        const buffer = Buffer.from(await blob.arrayBuffer());
        
        const fileName = `cover_${Date.now()}.png`;
        const imagePath = path.join(os.tmpdir(), fileName); 

        await fs.writeFile(imagePath, buffer);
        
        console.log(`✅ Image générée avec succès : ${imagePath}`);

        return imagePath; 

    } catch (error) {
        console.error("Erreur Image:", error.message);
        throw new Error(`Échec de la génération de l'image: ${error.message}`);
    }
}

module.exports = { generateImage };