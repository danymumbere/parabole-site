// Récupérer et afficher les histoires
async function renderStories() {
    const grid = document.getElementById('stories-grid');
    if (!grid) return;

    try {
        const response = await fetch('/api/stories');
        const dbStories = await response.json();

        grid.innerHTML = dbStories.map(story => `
            <div class="card">
                <img src="${story.coverImageUrl || 'default-cover.png'}" alt="Couverture de ${story.title}">
                <div class="card-content">
                    <h3 class="card-title">${story.title}</h3>
                    <p style="font-size: 0.8rem; color: var(--accent); margin-bottom: 1rem;">${story.verse}</p>
                    <a href="${story.pdfUrl}" target="_blank" class="btn btn-primary" style="display: block; text-align: center;">Lire le PDF</a>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error("Erreur de chargement des histoires :", error);
        grid.innerHTML = "<p>Impossible de charger les histoires pour le moment.</p>";
    }
}

const publicVapidKey = 'BLGgtnL-jHPRryVaWdjqCThVyA_Hk7XL_faNpxXWeBZyLqb4J4YOIFPw435gKqPItJfQ0yarz1-PmmbYEppRp6A'; // Ta clé publique

// CORRECTION : On sélectionne toutes les classes et on boucle dessus
const subscribeBtns = document.querySelectorAll('.btn-subscribe');
const messageEls = document.querySelectorAll('.msg-subscribe');

subscribeBtns.forEach((btn, index) => {
    btn.addEventListener('click', async () => {
        const messageEl = messageEls[index]; // Récupère le message correspondant au bouton cliqué

        // 1. Vérifier si le navigateur supporte les Service Workers et le Push
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            try {
                // 2. Enregistrer le Service Worker
                const register = await navigator.serviceWorker.register('/sw.js', {
                    scope: '/'
                });

                // 3. Demander la permission à l'utilisateur et s'abonner au Push Manager
                const subscription = await register.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
                });

                // 4. Envoyer l'abonnement à notre serveur Node.js
                await fetch('/api/subscribe', {
                    method: 'POST',
                    body: JSON.stringify(subscription),
                    headers: { 'Content-Type': 'application/json' }
                });

                messageEl.innerText = "Notifications activées avec succès !";
                messageEl.style.color = "green";
                
            } catch (error) {
                console.error("Erreur d'abonnement:", error);
                messageEl.innerText = "L'activation a échoué (avez-vous bloqué les permissions ?)";
                messageEl.style.color = "red";
            }
        } else {
            messageEl.innerText = "Les notifications ne sont pas supportées par votre navigateur.";
        }
    });
});

// Fonction utilitaire requise par web-push pour formater la clé publique
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

function preparerDon(reseau, code) {
    const num = "0906253050";
    
    // Essayer de copier le numéro dans le presse-papiers
    navigator.clipboard.writeText(num).then(() => {
        alert("Numéro " + num + " copié dans le presse-papiers ! Composez le " + code + " et suivez les étapes.");
    }).catch(err => {
        // Fallback si le navigateur bloque l'accès au presse-papiers
        alert("Composez le " + code + " et envoyez votre don au numéro : " + num);
    });

    // Affichage des instructions dans la petite boîte
    const instructionsDiv = document.getElementById('instructions-don');
    const texteInstruction = document.getElementById('texte-instruction');
    if (instructionsDiv && texteInstruction) {
        texteInstruction.innerText = `Instructions (${reseau}) : Le numéro ${num} a été copié. Composez le ${code}, choisissez l'option "Envoi d'argent", collez le numéro et validez. Merci pour votre générosité !`;
        instructionsDiv.classList.remove('hidden');
    }

    // Rediriger vers l'application téléphone
    window.location.href = "tel:" + code.replace("#", "%23");
}

// Initialisation
document.addEventListener('DOMContentLoaded', renderStories);