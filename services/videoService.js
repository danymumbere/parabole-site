const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); // binaire FFmpeg embarqué : rien à installer sur Render
const fs = require('fs');
const path = require('path');
const os = require('os');

if (process.env.FFMPEG_PATH || ffmpegPath) {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegPath);
}

// --- Réglages (modifiables via variables d'environnement Render) ---
// Résolution modeste par défaut : l'offre gratuite de Render a très peu de CPU/RAM.
const WIDTH = parseInt(process.env.VIDEO_WIDTH || '960', 10);
const HEIGHT = parseInt(process.env.VIDEO_HEIGHT || '540', 10);
const FPS = 25;
const FIT_MODE = process.env.VIDEO_FIT_MODE || 'pad'; // 'pad' = bandes noires, rien n'est coupé | 'crop' = remplit l'écran 16:9
const FADE = 0.5; // durée du fondu (secondes) au début et à la fin de chaque scène

const AUDIO_LEAD = 0.6;  // la voix démarre un peu après le fondu d'entrée
const AUDIO_TAIL = 0.8;  // petit silence à la fin de chaque scène

// Durée de chaque scène : calée sur la narration si elle existe, sinon estimée d'après la longueur du texte
function computeDurations(scenes) {
    return scenes.map(s => {
        if (typeof s.audioDuration === 'number' && s.audioDuration > 0) {
            return Math.round(Math.max(4, s.audioDuration + AUDIO_LEAD + AUDIO_TAIL) * 10) / 10;
        }
        const words = String(s.texte || '').trim().split(/\s+/).filter(Boolean).length;
        const seconds = 4 + words * 0.3;
        return Math.round(Math.min(14, Math.max(5, seconds)) * 10) / 10;
    });
}

// 4 mouvements de caméra alternés (effet Ken Burns)
function getMove(index, frames) {
    const cx = 'iw/2-(iw/zoom/2)';
    const cy = 'ih/2-(ih/zoom/2)';
    const moves = [
        { z: `1+0.15*on/${frames}`, x: cx, y: cy },                       // zoom avant
        { z: `1.15-0.15*on/${frames}`, x: cx, y: cy },                    // zoom arrière
        { z: '1.15', x: `(iw-iw/zoom)*on/${frames}`, y: cy },             // panoramique gauche → droite
        { z: '1.15', x: `(iw-iw/zoom)*(1-on/${frames})`, y: cy }          // panoramique droite → gauche
    ];
    return moves[index % moves.length];
}

async function downloadFile(url, destBase, defaultExt) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp'
        : type.includes('mpeg') || type.includes('mp3') ? '.mp3' : defaultExt;
    const filePath = destBase + ext;
    await fs.promises.writeFile(filePath, Buffer.from(await res.arrayBuffer()));
    return filePath;
}

// Crée un petit clip MP4 (image animée + narration) à partir d'UNE image
// audioPath = null -> piste silencieuse (tous les clips gardent le même format, indispensable pour l'assemblage)
function renderClip(imagePath, audioPath, clipPath, index, seconds) {
    return new Promise((resolve, reject) => {
        const frames = Math.round(seconds * FPS);
        const { z, x, y } = getMove(index, frames);
        const W2 = WIDTH * 2, H2 = HEIGHT * 2; // on travaille en 2x pour éviter les saccades du zoom

        const fit = FIT_MODE === 'crop'
            ? `scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2}`
            : `scale=${W2}:${H2}:force_original_aspect_ratio=decrease,pad=${W2}:${H2}:(ow-iw)/2:(oh-ih)/2:black`;

        const vf = [
            fit,
            'setsar=1',
            `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
            `fade=t=in:st=0:d=${FADE}`,
            `fade=t=out:st=${(seconds - FADE).toFixed(2)}:d=${FADE}`,
            'format=yuv420p'
        ].join(',');

        const cmd = ffmpeg(imagePath);
        if (audioPath) {
            cmd.input(audioPath);
        } else {
            cmd.input('anullsrc=channel_layout=mono:sample_rate=44100').inputFormat('lavfi');
        }

        cmd
            .videoFilters(vf)
            // 44,1 kHz mono ; décalage du début de la voix ; remplissage de silence jusqu'à la fin du clip
            .audioFilters([`aresample=44100`, `adelay=${Math.round(AUDIO_LEAD * 1000)}:all=1`, 'apad'])
            .outputOptions([
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-r', String(FPS),
                '-c:a', 'aac', '-b:a', '64k', '-ar', '44100', '-ac', '1',
                '-frames:v', String(frames), '-t', String(seconds), '-threads', '1'
            ])
            .on('end', () => resolve(clipPath))
            .on('error', reject)
            .save(clipPath);
    });
}

// Assemble les clips sans ré-encodage (très rapide, très peu de mémoire)
function concatClips(listPath, outPath) {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(listPath)
            .inputOptions(['-f', 'concat', '-safe', '0'])
            .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
            .on('end', () => resolve(outPath))
            .on('error', reject)
            .save(outPath);
    });
}

/**
 * scenes : [{ texte, imageUrl, audioUrl?, audioDuration? }]
 * outputVideoPath : chemin final du .mp4
 * Retourne les durées de chaque scène (utile pour synchroniser les sous-titres côté navigateur).
 */
async function generateStoryVideo(scenes, outputVideoPath) {
    const durations = computeDurations(scenes);
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'parabole-video-'));
    const partPath = outputVideoPath.replace(/\.mp4$/, '.part.mp4');

    try {
        const clipPaths = [];
        // Une scène à la fois (séquentiel) : on ménage la RAM de l'instance
        for (let i = 0; i < scenes.length; i++) {
            const img = await downloadFile(scenes[i].imageUrl, path.join(workDir, `scene_${i}`), '.jpg');
            let audio = null;
            if (scenes[i].audioUrl) {
                try {
                    audio = await downloadFile(scenes[i].audioUrl, path.join(workDir, `voice_${i}`), '.mp3');
                } catch (err) {
                    console.error(`Narration introuvable pour la scène ${i + 1} (scène muette) :`, err.message);
                }
            }
            const clip = path.join(workDir, `clip_${i}.mp4`);
            await renderClip(img, audio, clip, i, durations[i]);
            await fs.promises.unlink(img).catch(() => {});
            if (audio) await fs.promises.unlink(audio).catch(() => {});
            clipPaths.push(clip);
        }

        const listPath = path.join(workDir, 'list.txt');
        await fs.promises.writeFile(listPath, clipPaths.map(p => `file '${p}'`).join('\n'));

        await concatClips(listPath, partPath);
        await fs.promises.rename(partPath, outputVideoPath); // le fichier n'apparaît que lorsqu'il est complet
        return durations;
    } finally {
        await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
        await fs.promises.unlink(partPath).catch(() => {});
    }
}

// Ne garde que les `keep` vidéos les plus récentes (le disque de Render est limité)
async function pruneVideos(dir, keep = 10) {
    try {
        const files = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.mp4') && !f.endsWith('.part.mp4'));
        const stats = await Promise.all(files.map(async f => ({ f, t: (await fs.promises.stat(path.join(dir, f))).mtimeMs })));
        stats.sort((a, b) => b.t - a.t);
        for (const old of stats.slice(keep)) {
            await fs.promises.unlink(path.join(dir, old.f)).catch(() => {});
        }
    } catch (e) { /* dossier absent : rien à faire */ }
}

module.exports = { generateStoryVideo, computeDurations, pruneVideos };
