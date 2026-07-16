// Écoute les messages push venant du serveur
self.addEventListener('push', event => {
    const data = event.data.json();
    
    // Affichage de la notification
    self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icon.png', // Ajoute une petite image carrée dans ton dossier public
        data: { url: data.url } // On stocke l'URL du PDF pour le clic
    });
});

// Action lorsque l'utilisateur clique sur la notification
self.addEventListener('notificationclick', event => {
    event.notification.close(); // Ferme la notification
    
    // Ouvre un nouvel onglet vers le PDF
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});