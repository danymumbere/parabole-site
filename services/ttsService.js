const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const cloudinary = require('cloudinary').v2; // déjà configuré par votre cloudService
const fs = require('fs');
const path = require('path');
const os = require('os');

if (process.env.FFMPEG_PATH || ffmpegPath) {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegPath);
}

// --- Réglages (variables d'environnement) ---
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const TTS_VOICE = process.env.GEMINI_TTS_VOICE || 'Kore';
const TTS_STYLE = process.env.GEMINI_TTS_STYLE || "Lis ce récit à voix haute, d'une voix chaleureuse, posée et expressive, comme un conteur";
// Le palier gratuit est très limité (environ 2 requêtes/minute et 50/jour) : on espace les appels de ~31 s.
const MIN_INTERVAL_MS = parseInt(process.env.GEMINI_TTS_MIN_INTERVAL_MS || '31000', 10);
const MAX_ATTEMPTS = 4;

let lastCallAt = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function throttle() {
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
}

// Appelle l'API Gemini TTS -> { pcm: Buffer (16 bits, mono), sampleRate }
async function synthesizePcm(text) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("Clé GEMINI_API_KEY manquante (variables d'environnement).");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;
    const body = {
        contents: [{ parts: [{ text: `${TTS_STYLE} : ${text}` }] }],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } }
        }
    };

    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await throttle();
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify(body)
            });

            if (res.status === 429 || res.status >= 500) {
                lastError = new Error(`Gemini TTS indisponible (HTTP ${res.status})`);
                await sleep(25000 * attempt); // quota atteint : on patiente puis on réessaie
                continue;
            }
            if (!res.ok) {
                throw Object.assign(new Error(`Gemini TTS erreur ${res.status} : ${(await res.text()).slice(0, 300)}`), { fatal: true });
            }

            const data = await res.json();
            const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
            if (!part) {
                // Le modèle renvoie parfois une réponse vide : on réessaie
                lastError = new Error('Gemini TTS a renvoyé une réponse sans audio.');
                continue;
            }
            const rateMatch = /rate=(\d+)/.exec(part.inlineData.mimeType || '');
            return {
                pcm: Buffer.from(part.inlineData.data, 'base64'),
                sampleRate: rateMatch ? parseInt(rateMatch[1], 10) : 24000
            };
        } catch (err) {
            if (err.fatal) throw err;
            lastError = err;
            await sleep(5000 * attempt);
        }
    }
    throw lastError || new Error('Gemini TTS : échec.');
}

// PCM brut -> MP3 mono léger (stockage économique)
function pcmToMp3(pcmPath, sampleRate, mp3Path) {
    return new Promise((resolve, reject) => {
        ffmpeg(pcmPath)
            .inputFormat('s16le')
            .inputOptions(['-ar', String(sampleRate), '-ac', '1'])
            .audioCodec('libmp3lame')
            .outputOptions(['-b:a', '48k', '-ac', '1'])
            .on('end', () => resolve(mp3Path))
            .on('error', reject)
            .save(mp3Path);
    });
}

/**
 * Lit `text` à voix haute, l'envoie sur Cloudinary et retourne { audioUrl, audioDuration }.
 * La durée (en secondes) est calculée exactement à partir du PCM.
 */
async function narrateAndUpload(text, folder = 'parabole_audio') {
    const { pcm, sampleRate } = await synthesizePcm(text);
    const audioDuration = Math.round((pcm.length / 2 / sampleRate) * 100) / 100;

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'parabole-tts-'));
    try {
        const pcmPath = path.join(tmpDir, 'voice.pcm');
        const mp3Path = path.join(tmpDir, 'voice.mp3');
        await fs.promises.writeFile(pcmPath, pcm);
        await pcmToMp3(pcmPath, sampleRate, mp3Path);

        // Cloudinary range les fichiers audio sous le type "video"
        const result = await cloudinary.uploader.upload(mp3Path, { resource_type: 'video', folder });
        return { audioUrl: result.secure_url, audioDuration };
    } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = { narrateAndUpload };
