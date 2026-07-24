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
        // CORRECTION : On l'appelle bien tempCoverUrl
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
            // MAGIE ICI : On passe l'URL de la couverture (cloudCoverUrl) comme référence pour garder le même style/personnage !
            const imageUrl = await generateImage(scene.imagePrompt, cloudCoverUrl);
            scenesWithImages.push({ texte: scene.texte, imageUrl });
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
            coverImageUrl: cloudCoverUrl
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
});