const cloudinary = require('cloudinary').v2;
const fs = require('fs');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

async function uploadToCloud(localFilePath, folder = 'parabole_pdfs') {
    try {
        const result = await cloudinary.uploader.upload(localFilePath, {
            resource_type: 'auto',
            folder: folder
        });
        fs.unlinkSync(localFilePath); // Nettoyage du fichier local
        return result.secure_url;
    } catch (error) {
        console.error("Erreur lors de l'upload du PDF :", error);
        throw error;
    }
}

// --- NOUVELLE FONCTION ---
async function uploadImageFromUrl(imageUrl, folder = 'parabole_covers') {
    try {
        // Cloudinary télécharge l'image directement depuis l'URL de l'IA
        const result = await cloudinary.uploader.upload(imageUrl, {
            resource_type: 'image',
            folder: folder
        });
        return result.secure_url;
    } catch (error) {
        console.error("Erreur lors de l'upload de l'image distante :", error);
        throw error;
    }
}

// On exporte les deux fonctions
module.exports = { uploadToCloud, uploadImageFromUrl };