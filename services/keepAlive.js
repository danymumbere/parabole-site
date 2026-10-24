// Empêche Render (offre gratuite) d'endormir le serveur : il s'endort après 15 min sans trafic ENTRANT.
// Le site s'appelle donc lui-même, via son URL PUBLIQUE (pas localhost) : la requête sort puis
// rentre par le routeur de Render, ce qui compte comme du trafic entrant. Toutes les 14 min = marge de 1 min.
//
// Variables d'environnement (toutes optionnelles) :
//   RENDER_EXTERNAL_URL  : fournie automatiquement par Render (ex. https://parabole.onrender.com)
//   KEEP_ALIVE_URL       : pour forcer une autre URL (domaine personnalisé par exemple)
//   KEEP_ALIVE=false     : désactive le mécanisme (par ex. si vous passez à une offre payante)

const INTERVAL_MS = 14 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const TIMEOUT_MS = 25 * 1000; // un ping peut être lent si Render est en train de redémarrer l'instance

function startKeepAlive() {
    if (process.env.KEEP_ALIVE === 'false') {
        console.log('[keep-alive] désactivé (KEEP_ALIVE=false).');
        return;
    }

    const baseUrl = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
    if (!baseUrl) {
        console.log('[keep-alive] inactif : aucune URL publique (exécution en local).');
        return;
    }

    const url = baseUrl.replace(/\/+$/, '') + '/healthz';

    async function ping(isRetry = false) {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'parabole-keep-alive' },
                signal: AbortSignal.timeout(TIMEOUT_MS)
            });
            console.log(`[keep-alive] ping ${url} -> ${res.status}`);
            if (!res.ok && !isRetry) setTimeout(() => ping(true), RETRY_MS);
        } catch (err) {
            console.error(`[keep-alive] échec du ping : ${err.message}`);
            if (!isRetry) setTimeout(() => ping(true), RETRY_MS); // une seule nouvelle tentative rapide
        }
    }

    setInterval(() => ping(), INTERVAL_MS);
    console.log(`[keep-alive] actif : ping de ${url} toutes les 14 minutes.`);
}

module.exports = { startKeepAlive };
