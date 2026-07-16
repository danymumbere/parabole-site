const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema({
    // Le navigateur nous envoie un objet complet contenant les clés d'accès
    subscription: { 
        type: Object, 
        required: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('Subscriber', subscriberSchema);