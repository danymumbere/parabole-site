const axios = require('axios');
const fs = require('fs').promises; 
const path = require('path');
const os = require('os'); // Ajout de 'os' pour gérer les dossiers temporaires

async function generateImage(prompt, referenceImage = null) {
    const styleModifier = "full frame composition, modern minimalist graphic design, 2D flat illustration, not 3D, 16:9 aspect ratio";
    const finalPrompt = `${prompt}, ${styleModifier}`;

    try {
        // Remplacement par le modèle open-source SDXL (Stable Diffusion XL)
        const response = await axios.post(
            'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
            {
                inputs: finalPrompt,
                // SDXL gère très bien le format par défaut, on peut retirer width/height 
                // pour éviter les conflits d'API avec les comptes gratuits.
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'image/png'
                },
                responseType: 'arraybuffer' 
            }
        );

        const fileName = `cover_${Date.now()}.png`;
        
        // Utilisation de os.tmpdir() : C'est le dossier temporaire sécurisé de Render.
        // Cela évite l'erreur "ENOENT: no such file or directory, open '.../outputs/...'"
        const imagePath = path.join(os.tmpdir(), fileName); 

        await fs.writeFile(imagePath, response.data);
        
        console.log(`✅ Image générée avec succès : ${imagePath}`);

        // On retourne le chemin. Plus tard, ton cloudService.js l'enverra sur Cloudinary
        // et Render supprimera automatiquement ce fichier temporaire.
        return imagePath; 

    } catch (error) {
        const errorMsg = error.response && error.response.data
            ? Buffer.from(error.response.data).toString('utf-8') 
            : error.message;
            
        console.error("Erreur Image:", errorMsg);
        throw new Error(`Échec de la génération de l'image: ${errorMsg}`);
    }
}

module.exports = { generateImage };