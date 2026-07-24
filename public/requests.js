// =====================================================================
// PAGE DE SUIVI DES REQUÊTES (style fil de messages WhatsApp)
// =====================================================================

const API_BASE = '/api/requests';

// Libellés et couleurs des catégories
const CATEGORY_META = {
    bug: { label: '🐞 Bug / erreur', color: '#e74c3c' },
    ux: { label: '🎨 Expérience utilisateur', color: '#9b59b6' },
    tech: { label: '⚙️ Architecturale / technique', color: '#16a085' }
};

// Échappe le HTML pour éviter toute injection dans les messages
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

// Formate une date à la manière de WhatsApp (hh:mm)
function formatTime(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Génère le HTML des accusés de réception selon l'état des checks
function renderChecks(req) {
    const confirmed = req.devCheck && req.userCheck;
    let cls, icon, title;
    if (confirmed) {
        cls = 'checks checks-done';
        icon = '✓✓';
        title = 'Confirmé : fait par le dev et vu par l\'utilisateur';
    } else if (req.devCheck) {
        cls = 'checks checks-dev';
        icon = '✓✓';
        title = 'Fait par le développeur, en attente de confirmation utilisateur';
    } else {
        cls = 'checks checks-none';
        icon = '✓';
        title = 'Pas encore traité';
    }
    return `<span class="${cls}" data-id="${req._id}" data-dev="${!!req.devCheck}" data-user="${!!req.userCheck}" title="${title}">${icon}</span>`;
}

// Construit le HTML d'une bulle de requête
function renderBubble(req) {
    const meta = CATEGORY_META[req.category] || { label: req.category, color: '#7F8C8D' };
    const donBadge = req.amountOk
        ? '<span class="don-badge don-ok">Don joint ✓</span>'
        : '<span class="don-badge don-ko">Don insuffisant ✗</span>';

    const refLine = req.transactionRef
        ? `<div class="wa-ref">Réf. transaction : <strong>${escapeHtml(req.transactionRef)}</strong></div>`
        : '';
    const networkLine = req.network
        ? `<span class="wa-network">${escapeHtml(req.network)}</span>`
        : '';

    return `
        <div class="wa-bubble" data-id="${req._id}">
            <div class="wa-bubble-header">
                <span class="wa-cat-badge" style="background:${meta.color}">${escapeHtml(meta.label)}</span>
                <span class="wa-amount">${escapeHtml(String(req.amount))} $</span>
                ${networkLine}
            </div>
            <div class="wa-message">${escapeHtml(req.message)}</div>
            ${refLine}
            <div class="wa-footer">
                <span class="wa-don">${donBadge}</span>
                <span class="wa-time">${escapeHtml(formatTime(req.createdAt))} ${renderChecks(req)}</span>
            </div>
        </div>
    `;
}

// Affiche les requêtes regroupées par section (déjà triées par l'API)
function renderRequests(requests) {
    const container = document.getElementById('requests-list');
    if (!requests.length) {
        container.innerHTML = '<p style="text-align:center; color: var(--text-muted); padding: 2rem;">Aucune requête pour le moment.</p>';
        return;
    }

    // Regroupement : les non-confirmés par catégorie, puis les confirmés
    const groups = {
        bug: { title: '🐞 Bug / erreur', items: [] },
        ux: { title: '🎨 Expérience utilisateur', items: [] },
        tech: { title: '⚙️ Architecturale / technique', items: [] },
        done: { title: '✅ Déjà implémenté et confirmé', items: [] }
    };

    requests.forEach(r => {
        if (r.devCheck && r.userCheck) groups.done.items.push(r);
        else groups[r.category]?.items.push(r);
    });

    let html = '';
    Object.values(groups).forEach(g => {
        if (!g.items.length) return;
        html += `<section class="wa-section">
            <h2 class="wa-section-title">${escapeHtml(g.title)} <span class="wa-count">(${g.items.length})</span></h2>`;
        g.items.forEach(r => { html += renderBubble(r); });
        html += `</section>`;
    });

    container.innerHTML = html;
    attachCheckListeners();
}

// Branche les clics sur les accusés de réception
function attachCheckListeners() {
    document.querySelectorAll('.wa-bubble .checks').forEach(el => {
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            const bubble = el.closest('.wa-bubble');
            const id = bubble.dataset.id;
            const isDevDone = el.dataset.dev === 'true';
            const isUserDone = el.dataset.user === 'true';

            // Choix de l'action : si le dev n'a pas coché -> check dev ; sinon -> check user
            let endpoint, codePrompt, body, okMsg;
            if (!isDevDone) {
                codePrompt = 'Entrez le code DÉVELOPPEUR pour confirmer que la modification a été faite :';
                const devCode = prompt(codePrompt);
                if (!devCode) return;
                endpoint = `${API_BASE}/${id}/dev-check`;
                body = { devCode: devCode.trim() };
                okMsg = '1er accusé (développeur) mis à jour.';
            } else if (!isUserDone) {
                codePrompt = 'Entrez votre CODE UNIQUE pour confirmer que vous avez vu la modification :';
                const userCode = prompt(codePrompt);
                if (!userCode) return;
                endpoint = `${API_BASE}/${id}/user-check`;
                body = { userCode: userCode.trim().toUpperCase() };
                okMsg = '2e accusé (utilisateur) mis à jour.';
            } else {
                // Tout est coché : permet de décocher le check utilisateur
                codePrompt = 'Décocher votre accusé ? Entrez votre CODE UNIQUE :';
                const userCode = prompt(codePrompt);
                if (!userCode) return;
                endpoint = `${API_BASE}/${id}/user-check`;
                body = { userCode: userCode.trim().toUpperCase() };
                okMsg = 'Accusé utilisateur retiré.';
            }

            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const result = await res.json();
                if (!res.ok) throw new Error(result.error || "Échec de la mise à jour.");
                alert(okMsg);
                loadRequests(); // Recharger la liste pour mettre à jour l'ordre et les états
            } catch (err) {
                alert("Erreur : " + err.message);
            }
        });
    });
}

// Récupère les requêtes depuis l'API (déjà triées)
async function loadRequests() {
    try {
        const res = await fetch(API_BASE);
        const requests = await res.json();
        renderRequests(requests);
    } catch (err) {
        document.getElementById('requests-list').innerHTML =
            '<p style="text-align:center; color:#c0392b;">Impossible de charger les requêtes.</p>';
    }
}

// Chargement initial
document.addEventListener('DOMContentLoaded', loadRequests);
