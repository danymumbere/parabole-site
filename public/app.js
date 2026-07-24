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

// =====================================================================
// SYSTÈME "DONNER UN COUP DE POUCE" (Modal : instructions + formulaire)
// =====================================================================

const DON_NUMBER = "0906253050";

// Ouvre le modal
function openCoupDePouceModal() {
    const modal = document.getElementById('modal-coup-de-pouce');
    if (!modal) return;
    document.getElementById('modal-form-step').classList.remove('hidden');
    document.getElementById('modal-confirm-step').classList.add('hidden');
    document.getElementById('form-error').textContent = '';
    modal.classList.remove('hidden');
}

// Ferme le modal et réinitialise le formulaire
function closeCoupDePouceModal() {
    const modal = document.getElementById('modal-coup-de-pouce');
    if (!modal) return;
    modal.classList.add('hidden');
    const form = document.getElementById('form-requete');
    if (form) form.reset();
    document.getElementById('req-network').value = '';
    document.querySelectorAll('#network-picker button').forEach(b => b.classList.remove('selected'));
    const hint = document.getElementById('net-hint');
    if (hint) hint.textContent = '';
}

document.addEventListener('DOMContentLoaded', () => {
    const headerBtn = document.getElementById('btn-coup-de-pouce-header');
    const mainBtn = document.getElementById('btn-coup-de-pouce-main');
    const closeBtn = document.getElementById('modal-close-btn');
    const overlay = document.getElementById('modal-coup-de-pouce');

    if (headerBtn) headerBtn.addEventListener('click', openCoupDePouceModal);
    if (mainBtn) mainBtn.addEventListener('click', openCoupDePouceModal);
    if (closeBtn) closeBtn.addEventListener('click', closeCoupDePouceModal);
    // Fermer en cliquant sur l'arrière-plan
    if (overlay) overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCoupDePouceModal();
    });
    // Fermer avec la touche Échap
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) closeCoupDePouceModal();
    });

    // --- Sélection du réseau dans le formulaire ---
    const networkPicker = document.getElementById('network-picker');
    const networkInput = document.getElementById('req-network');
    const netHint = document.getElementById('net-hint');
    if (networkPicker) {
        networkPicker.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                const network = btn.dataset.network;
                const code = btn.dataset.code;
                networkPicker.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                networkInput.value = network;
                // Copie du numéro + composition USSD (réutilise l'ancienne logique)
                navigator.clipboard?.writeText(DON_NUMBER).catch(() => {});
                netHint.textContent = `Numéro ${DON_NUMBER} copié. Composez ${code}, choisissez "Envoi d'argent", collez le numéro et validez.`;
                // Redirige vers l'application téléphone
                window.location.href = "tel:" + code.replace("#", "%23");
            });
        });
    }

    // --- Soumission du formulaire ---
    const form = document.getElementById('form-requete');
    const errorEl = document.getElementById('form-error');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorEl.textContent = '';
            const submitBtn = document.getElementById('form-submit-btn');
            const data = {
                category: form.category.value,
                message: form.message.value,
                amount: form.amount.value,
                network: form.network.value,
                transactionRef: form.transactionRef.value
            };

            if (!data.network) {
                errorEl.textContent = "Veuillez choisir un réseau pour le don.";
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = "Envoi en cours...";

            try {
                const res = await fetch('/api/requests', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if (!res.ok) throw new Error(result.error || "Erreur lors de l'envoi.");

                // Sauvegarde du code utilisateur en localStorage (permet de retrouver la requête)
                try {
                    const saved = JSON.parse(localStorage.getItem('parabole:userCodes') || '[]');
                    saved.push({ id: result.id, userCode: result.userCode, category: data.category });
                    localStorage.setItem('parabole:userCodes', JSON.stringify(saved));
                } catch (e) { /* localStorage indisponible : on continue */ }

                // Affichage de l'écran de confirmation
                document.getElementById('user-code-display').textContent = result.userCode;
                document.getElementById('modal-form-step').classList.add('hidden');
                document.getElementById('modal-confirm-step').classList.remove('hidden');
            } catch (err) {
                errorEl.textContent = err.message;
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = "Envoyer ma requête";
            }
        });
    }

    // --- Copier le code unique ---
    const copyBtn = document.getElementById('copy-code-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const code = document.getElementById('user-code-display').textContent;
            if (code && code !== '------') {
                navigator.clipboard?.writeText(code).then(() => {
                    copyBtn.textContent = "✅ Copié !";
                    setTimeout(() => copyBtn.textContent = "📋 Copier le code", 2000);
                }).catch(() => {});
            }
        });
    }
});

// Initialisation
document.addEventListener('DOMContentLoaded', renderStories);