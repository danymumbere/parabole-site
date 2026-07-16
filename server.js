require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const connectDB = require('./config/db');
const { generateStory } = require('./services/llmService');
const { generateImage } = require('./services/imageService');
const { createPDF } = require('./services/pdfService');
const Story = require('./models/Story');
const Subscriber = require('./models/Subscriber');
const webpush = require('web-push');
const { uploadToCloud, uploadImageFromUrl } = require('./services/cloudService');

const app = express();
app.use(express.json());

const path = require('path');

// Exposer le dossier public (HTML, CSS, JS et les PDFs générés)
app.use(express.static(path.join(__dirname, 'public')));

// Configuration Web Push
webpush.setVapidDetails(
    process.env.EMAIL_CONTACT,
    process.env.PUBLIC_VAPID_KEY,
    process.env.PRIVATE_VAPID_KEY
);

// --- NOUVELLE ROUTE POUR SAUVEGARDER L'ABONNEMENT ---
app.post('/api/subscribe', async (req, res) => {
    try {
        const subscription = req.body;
        // On sauvegarde l'objet d'abonnement dans MongoDB
        const newSub = new Subscriber({ subscription });
        await newSub.save();
        res.status(201).json({ message: "Abonnement Push réussi !" });
    } catch (error) {
        console.error("Erreur d'abonnement:", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// --- NOUVELLE ROUTE API ---
// Permet au frontend de récupérer la liste des histoires
app.get('/api/stories', async (req, res) => {
    try {
        // Récupère toutes les histoires, triées de la plus récente à la plus ancienne
        const stories = await Story.find().sort({ createdAt: -1 });
        res.status(200).json(stories);
    } catch (error) {
        console.error("Erreur lors de la récupération :", error);
        res.status(500).json({ message: "Erreur serveur" });
    }
});


// S'assurer que le dossier public existe
if (!fs.existsSync('./public/pdfs')){
    fs.mkdirSync('./public/pdfs', { recursive: true });
}

connectDB();

async function runParabolePipeline() {
    console.log("=== Lancement de la Pipeline Parabole ===");
    try {
        // 1. Génération de l'histoire
        console.log("1. Rédaction de l'histoire...");
        const storyData = await generateStory();
        
        // 2. Génération de la couverture
        console.log("2. Création de la couverture...");
        const coverPrompt = `Cover art for a book titled '${storyData.titre}'. Main character: ${storyData.consistance.personnagePrincipal}.`;
        const tempCoverUrl = await generateImage(coverPrompt);

        // --- NOUVELLE ÉTAPE : SÉCURISATION DE L'IMAGE ---
        console.log("2.5. Sauvegarde de la couverture sur le Cloud...");
        const cloudCoverUrl = await uploadImageFromUrl(tempCoverUrl, 'parabole_covers');
        console.log(`Couverture sécurisée à l'adresse : ${cloudCoverUrl}`);

        // 3. Génération des scènes
        console.log("3. Illustration des scènes...");
        const scenesWithImages = [];
        for (const scene of storyData.scenes) {
            console.log('Illustration de la scène...');
            const imageUrl = await generateImage(scene.imagePrompt);
            scenesWithImages.push({ texte: scene.texte, imageUrl });
        }

        // 4. Génération du PDF
        console.log("4. Assemblage du PDF...");
        const filename = `parabole-${Date.now()}.pdf`;
        const pdfPath = cloudPdfUrl;
        await createPDF(storyData, cloudCoverUrl, scenesWithImages, pdfPath);

        // --- NOUVELLE ÉTAPE : UPLOAD CLOUD ---
        console.log("4.5. Envoi du PDF vers le Cloud...");
        const cloudPdfUrl = await uploadToCloud(pdfPath, 'parabole_pdfs');
        console.log(`PDF sécurisé à l'adresse : ${cloudPdfUrl}`);

        // 5. Sauvegarde en Base de Données
        console.log("5. Sauvegarde en BD...");
        const newStory = new Story({
            title: storyData.titre,
            verse: storyData.verset,
            pdfUrl: cloudPdfUrl,
            coverImageUrl: cloudCoverUrl
        });
        await newStory.save();

        // 6. ENVOI DES NOTIFICATIONS PUSH
        console.log("6. Envoi des notifications...");
        const payload = JSON.stringify({
            title: "Nouvelle Parabole Disponible !",
            body: `L'histoire du jour inspirée de ${storyData.verset} vient de sortir.`,
            url: `/pdfs/${filename}` // L'URL à ouvrir quand l'utilisateur clique
        });

        const subscribers = await Subscriber.find();
        
        // On envoie le message à tous les abonnés en parallèle
        const pushPromises = subscribers.map(sub => 
            webpush.sendNotification(sub.subscription, payload)
            .catch(err => {
                console.error("Erreur d'envoi à un abonné (peut-être désinscrit):", err);
                // Optionnel : supprimer l'abonné de la base s'il a révoqué l'accès (status 410)
                if(err.statusCode === 410) {
                    return Subscriber.deleteOne({ _id: sub._id });
                }
            })
        );
        await Promise.all(pushPromises);

        console.log("=== Pipeline terminée avec succès ! ===");
    } catch (error) {
        console.error("Erreur lors de l'exécution de la pipeline :", error);
    }
}

// Planification de la tâche : S'exécute tous les jours à 18h00 (Heure d'Afrique Centrale)
cron.schedule('0 18 * * *', () => {
    runParabolePipeline();
}, {
    scheduled: true,
    timezone: "Africa/Bujumbura" // Fuseau horaire UTC+2 équivalent à Goma
});

// Route manuelle pour déclencher la pipeline
app.post('/api/generate', async (req, res) => {
    runParabolePipeline(); // Non-bloquant
    res.status(202).json({ message: "Génération lancée en arrière-plan." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur Parabole en écoute sur le port ${PORT}`);
});