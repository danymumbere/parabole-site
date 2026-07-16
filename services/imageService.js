const axios = require('axios');
const fs = require('fs').promises; 
const path = require('path');

async function generateImage(prompt, referenceImage = null) {
    const styleModifier = "full frame composition, modern minimalist graphic design, 2D flat illustration, not 3D, 16:9 aspect ratio";
    const finalPrompt = `${prompt}, ${styleModifier}`;

    try {
        const response = await axios.post(
            'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
            {
                inputs: finalPrompt,
                parameters: {
                    width: 1024,
                    height: 576,
                    num_inference_steps: 4
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'image/png' // 👈 LA CORRECTION EST ICI
                },
                responseType: 'arraybuffer' 
            }
        );

        const fileName = `cover_${Date.now()}.png`;
        const imagePath = path.join(__dirname, '..', 'outputs', fileName); 

        await fs.writeFile(imagePath, response.data);
        
        console.log(`✅ Image générée avec succès : ${imagePath}`);

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