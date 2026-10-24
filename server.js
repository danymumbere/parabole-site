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
const Request = require('./models/Request');
const { CATEGORY_MIN_AMOUNT } = require('./models/Request');
const webpush = require('web-push');
const { uploadToCloud, uploadImageFromUrl } = require('./services/cloudService');
const mongoose = require('mongoose');
const { generateStoryVideo, computeDurations, pruneVideos } = require('./services/videoService');
const { startKeepAlive } = require('./services/keepAlive');
const { narrateAndUpload } = require('./services/ttsService');

const app = express();
app.use(express.json());

const path = require('path');

// Exposer le dossier public (HTML, CSS, JS et les PDFs générés)
app.use(express.static(path.join(__dirname, 'public')));

// Route légère pour le keep-alive et le "Health Check Path" de Render (pas de base de données, réponse minimale)
app.get('/healthz', (req, res) => res.status(200).send('ok'));

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

// --- ROUTES API POUR LE SYSTÈME DE REQUÊTES ("DONNER UN COUP DE POUCE") ---

// Génère un code utilisateur unique de 6 caractères alphanumériques (sans caractères ambigus)
const AMBIGUOUS_CHARS = '0O1Il';
function generateUserCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (AMBIGUOUS_CHARS.split('').some(c => code.includes(c)));
    return code;
}

// Labels des catégories pour le tri et l'affichage
const CATEGORY_LABELS = {
    bug: 'Bug / erreur',
    ux: 'Expérience utilisateur',
    tech: 'Architecturale / technique'
};
// Ordre de priorité d'affichage sur la page de suivi
const CATEGORY_ORDER = { bug: 1, ux: 2, tech: 3 };

// Création d'une nouvelle requête
app.post('/api/requests', async (req, res) => {
    try {
        const { category, message, amount, network, transactionRef } = req.body;

        // Validation des champs requis
        if (!category || !message || amount === undefined) {
            return res.status(400).json({ error: "Catégorie, message et montant sont requis." });
        }
        if (!CATEGORY_MIN_AMOUNT[category]) {
            return res.status(400).json({ error: "Catégorie invalide." });
        }

        const minAmount = CATEGORY_MIN_AMOUNT[category];

        // Vérification du montant minimum par catégorie
        if (Number(amount) < minAmount) {
            return res.status(400).json({
                error: `Le montant minimum pour cette catégorie est de ${minAmount} $.`,
                minAmount
            });
        }

        // Génération d'un code utilisateur unique (avec vérification d'unicité en BD)
        let userCode;
        let attempts = 0;
        while (attempts < 10) {
            userCode = generateUserCode();
            const exists = await Request.findOne({ userCode });
            if (!exists) break;
            attempts++;
        }

        const newRequest = new Request({
            category,
            message: String(message).trim(),
            amount: Number(amount),
            network: network ? String(network) : undefined,
            transactionRef: transactionRef ? String(transactionRef).trim() : undefined,
            amountOk: Number(amount) >= minAmount,
            userCode
        });

        await newRequest.save();

        res.status(201).json({
            message: "Requête envoyée avec succès.",
            id: newRequest._id,
            userCode,
            categoryLabel: CATEGORY_LABELS[category]
        });
    } catch (error) {
        console.error("Erreur lors de la création de la requête:", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Récupération des requêtes, triées : bug, ux, tech, puis confirmées
app.get('/api/requests', async (req, res) => {
    try {
        const requests = await Request.find().lean();
        const sorted = requests.sort((a, b) => {
            // "Confirmé" = les deux checks cochés -> va à la fin
            const aConfirmed = a.devCheck && a.userCheck;
            const bConfirmed = b.devCheck && b.userCheck;
            if (aConfirmed !== bConfirmed) return aConfirmed ? 1 : -1;
            // Même statut confirmé/non -> tri par priorité de catégorie
            const catDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
            if (catDiff !== 0) return catDiff;
            // Même catégorie -> du plus ancien au plus récent (file d'attente)
            return new Date(a.createdAt) - new Date(b.createdAt);
        });
        res.status(200).json(sorted.map(r => ({ ...r, categoryLabel: CATEGORY_LABELS[r.category] })));
    } catch (error) {
        console.error("Erreur lors de la récupération des requêtes:", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// 1er accusé de réception : le développeur a effectué la modification (protégé par DEV_CODE)
app.post('/api/requests/:id/dev-check', async (req, res) => {
    try {
        const { devCode } = req.body;
        if (!devCode || devCode !== process.env.DEV_CODE) {
            return res.status(403).json({ error: "Code développeur incorrect." });
        }
        const request = await Request.findById(req.params.id);
        if (!request) return res.status(404).json({ error: "Requête introuvable." });

        request.devCheck = !request.devCheck;
        request.devCheckAt = request.devCheck ? new Date() : null;
        await request.save();

        res.status(200).json({ devCheck: request.devCheck, message: "Accusé développeur mis à jour." });
    } catch (error) {
        console.error("Erreur dev-check:", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// 2e accusé de réception : l'utilisateur a constaté la modification (protégé par son code unique)
app.post('/api/requests/:id/user-check', async (req, res) => {
    try {
        const { userCode } = req.body;
        const request = await Request.findById(req.params.id);
        if (!request) return res.status(404).json({ error: "Requête introuvable." });

        if (!userCode || userCode.toUpperCase() !== request.userCode) {
            return res.status(403).json({ error: "Code utilisateur incorrect." });
        }

        request.userCheck = !request.userCheck;
        request.userCheckAt = request.userCheck ? new Date() : null;
        await request.save();

        res.status(200).json({ userCheck: request.userCheck, message: "Accusé utilisateur mis à jour." });
    } catch (error) {
        console.error("Erreur user-check:", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// --- NOUVELLE ROUTE API ---
// Permet au frontend de récupérer la liste des histoires
app.get('/api/stories', async (req, res) => {
    try {
        // Récupère toutes les histoires, triées de la plus récente à la plus ancienne
        // .lean() + on n'envoie pas toutes les scènes à la page d'accueil, juste un indicateur "hasVideo"
        const stories = await Story.find().sort({ createdAt: -1 }).lean();
        res.status(200).json(stories.map(({ scenes, ...story }) => ({
            ...story,
            hasVideo: Array.isArray(scenes) && scenes.length > 0
        })));
    } catch (error) {
        console.error("Erreur lors de la récupération :", error);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// --- VIDÉO À LA DEMANDE ---
// Les vidéos sont compilées avec FFmpeg au premier clic puis gardées en cache sur le disque
// (éphémère sur Render : elles seront simplement recompilées après un redéploiement/redémarrage).
const VIDEO_DIR = path.join(__dirname, 'public', 'videos');
const MAX_CACHED_VIDEOS = parseInt(process.env.MAX_CACHED_VIDEOS || '10', 10);
const videoJobs = new Map();      // storyId -> { status: 'processing' | 'error', error? }
let videoQueue = Promise.resolve(); // une seule compilation à la fois (protège la RAM/CPU de Render)

app.get('/api/stories/:id/video', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ error: "Identifiant invalide." });
        }

        const story = await Story.findById(id).lean();
        if (!story || !story.scenes || story.scenes.length === 0) {
            return res.status(404).json({ error: "Aucune vidéo disponible pour cette histoire." });
        }

        const fileName = `video-${story._id}.mp4`;
        const localPath = path.join(VIDEO_DIR, fileName);
        const payload = {
            status: 'ready',
            videoUrl: `/videos/${fileName}`,
            durations: computeDurations(story.scenes),
            captions: story.scenes.map(s => s.texte)
        };

        // 1. Déjà compilée -> on la renvoie tout de suite
        if (fs.existsSync(localPath)) {
            return res.json(payload);
        }

        // 2. Compilation en cours ou échouée
        const job = videoJobs.get(id);
        if (job && job.status === 'processing') {
            return res.status(202).json({ status: 'processing' });
        }
        if (job && job.status === 'error') {
            videoJobs.delete(id); // le prochain clic relancera une tentative
            return res.status(500).json({ status: 'error', error: "La compilation de la vidéo a échoué. Réessayez." });
        }

        // 3. Lancement de la compilation en arrière-plan (file d'attente)
        videoJobs.set(id, { status: 'processing' });
        console.log(`Compilation de la vidéo : ${story.title}`);
        videoQueue = videoQueue.then(async () => {
            try {
                await generateStoryVideo(story.scenes, localPath);
                videoJobs.delete(id);
                await pruneVideos(VIDEO_DIR, MAX_CACHED_VIDEOS);
                console.log(`Vidéo prête : ${fileName}`);
            } catch (err) {
                console.error("Erreur FFmpeg :", err);
                videoJobs.set(id, { status: 'error', error: err.message });
            }
        });

        return res.status(202).json({ status: 'processing' });
    } catch (error) {
        console.error("Erreur route vidéo :", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});


// S'assurer que le dossier public existe
if (!fs.existsSync('./public/pdfs')){
    fs.mkdirSync('./public/pdfs', { recursive: true });
}
if (!fs.existsSync('./public/videos')){
    fs.mkdirSync('./public/videos', { recursive: true });
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
        // CORRECTION : On l'appelle bien tempCoverUrl
        const tempCoverUrl = await generateImage(coverPrompt);

        // --- NOUVELLE ÉTAPE : SÉCURISATION DE L'IMAGE ---
        console.log("2.5. Sauvegarde de la couverture sur le Cloud...");
        const cloudCoverUrl = await uploadImageFromUrl(tempCoverUrl, 'parabole_covers');
        console.log(`Couverture sécurisée à l'adresse : ${cloudCoverUrl}`);

        // 3. Génération des scènes
        console.log("3. Illustration des scènes...");
        const scenesWithImages = [];   // URLs temporaires -> utilisées pour le PDF
        const scenesForDb = [];        // URLs Cloudinary permanentes -> utilisées pour la vidéo
        for (const scene of storyData.scenes) {
            console.log('Illustration de la scène...');
            // MAGIE ICI : On passe l'URL de la couverture (cloudCoverUrl) comme référence pour garder le même style/personnage !
            const imageUrl = await generateImage(scene.imagePrompt, cloudCoverUrl);
            scenesWithImages.push({ texte: scene.texte, imageUrl });

            // Les URLs de génération sont souvent temporaires : on sécurise chaque scène sur le Cloud
            let permanentUrl = imageUrl;
            try {
                permanentUrl = await uploadImageFromUrl(imageUrl, 'parabole_scenes');
            } catch (err) {
                console.error("Sauvegarde cloud de la scène échouée (URL temporaire conservée) :", err.message);
            }

            // Narration à voix haute (Gemini TTS) : générée UNE fois ici, réutilisée à chaque compilation vidéo
            let audioUrl, audioDuration;
            try {
                console.log('Narration de la scène...');
                ({ audioUrl, audioDuration } = await narrateAndUpload(scene.texte));
            } catch (err) {
                console.error("Narration échouée (la scène sera muette dans la vidéo) :", err.message);
            }

            scenesForDb.push({ texte: scene.texte, imageUrl: permanentUrl, audioUrl, audioDuration });
        }

        // 4. Génération du PDF
        console.log("4. Assemblage du PDF...");
        const filename = `parabole-${Date.now()}.pdf`;
        const pdfPath = `./public/pdfs/${filename}`; // p minuscule
        // CORRECTION : On utilise pdfPath
        await createPDF(storyData, tempCoverUrl, scenesWithImages, pdfPath);

        // --- NOUVELLE ÉTAPE : UPLOAD CLOUD ---
        console.log("4.5. Envoi du PDF vers le Cloud...");
        // CORRECTION : On utilise pdfPath
        const cloudPdfUrl = await uploadToCloud(pdfPath, 'parabole_pdfs');
        console.log(`PDF sécurisé à l'adresse : ${cloudPdfUrl}`);

        // 5. Sauvegarde en Base de Données
        console.log("5. Sauvegarde en BD...");
        const newStory = new Story({
            title: storyData.titre,
            verse: storyData.verset,
            pdfUrl: cloudPdfUrl,
            coverImageUrl: cloudCoverUrl,
            scenes: scenesForDb
        });
        await newStory.save();

        // 6. ENVOI DES NOTIFICATIONS PUSH
        console.log("6. Envoi des notifications...");
        const payload = JSON.stringify({
            title: "Nouvelle Parabole Disponible !",
            body: `L'histoire du jour inspirée de ${storyData.verset} vient de sortir.`,
            url: cloudPdfUrl // CORRECTION : Redirige vers Cloudinary
        });

        const subscribers = await Subscriber.find();
        
        // On envoie le message à tous les abonnés en parallèle
        const pushPromises = subscribers.map(sub => 
            webpush.sendNotification(sub.subscription, payload)
            .catch(err => {
                console.error("Erreur d'envoi à un abonné (peut-être désinscrit):", err);
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
//cron.schedule('0 18 * * *', () => {
//    runParabolePipeline();
//}, {
//    scheduled: true,
//    timezone: "Africa/Bujumbura" // Fuseau horaire UTC+2 équivalent à Goma
//});

// Route temporaire de secours en GET (accessible directement depuis ton navigateur)
app.get('/api/generate-now', async (req, res) => {
    try {
        runParabolePipeline(); // Lance la pipeline en arrière-plan
        res.send("<h1>🚀 Pipeline lancée ! Regarde tes logs sur Render.</h1>");
    } catch (error) {
        res.status(500).send("Erreur lors du lancement : " + error.message);
    }
});

// Route manuelle pour déclencher la pipeline
app.post('/api/generate', async (req, res) => {
    runParabolePipeline(); // Non-bloquant
    res.status(202).json({ message: "Génération lancée en arrière-plan." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur Parabole en écoute sur le port ${PORT}`);
    startKeepAlive(); // le site se ping lui-même toutes les 14 min pour ne pas s'endormir
});