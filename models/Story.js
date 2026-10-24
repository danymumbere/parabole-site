const mongoose = require('mongoose');

// Une scène = un morceau de l'histoire + son illustration (URL Cloudinary PERMANENTE)
const sceneSchema = new mongoose.Schema({
    texte: { type: String, required: true },
    imageUrl: { type: String, required: true },
    audioUrl: { type: String },       // narration (MP3 sur Cloudinary)
    audioDuration: { type: Number }   // durée de la narration en secondes
}, { _id: false });

const storySchema = new mongoose.Schema({
    title: { type: String, required: true },
    verse: { type: String, required: true },
    pdfUrl: { type: String },
    coverImageUrl: { type: String },
    scenes: { type: [sceneSchema], default: [] }, // Sert à compiler la vidéo à la demande
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Story', storySchema);
