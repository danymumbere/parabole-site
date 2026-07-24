const mongoose = require('mongoose');

// Montants minimums par catégorie de requête (en dollars)
const CATEGORY_MIN_AMOUNT = {
    bug: 1,
    ux: 5,
    tech: 10
};

const requestSchema = new mongoose.Schema({
    // Nature de la demande : bug/erreur, expérience utilisateur, ou modification architecturale/technique
    category: {
        type: String,
        enum: ['bug', 'ux', 'tech'],
        required: true
    },
    // Message décrivant ce que l'utilisateur veut voir changer
    message: {
        type: String,
        required: true
    },
    // Montant du don déclaré par l'utilisateur (en dollars)
    amount: {
        type: Number,
        required: true
    },
    // Réseau mobile money utilisé (M-Pesa, Airtel, Orange, Africell)
    network: {
        type: String
    },
    // Référence/ID de la transaction (reçu par SMS)
    transactionRef: {
        type: String
    },
    // Vrai si le montant est >= au minimum de la catégorie (calculé à la création)
    amountOk: {
        type: Boolean,
        default: false
    },
    // Code unique remis à l'utilisateur pour activer le 2e accusé de réception
    userCode: {
        type: String,
        required: true,
        unique: true
    },
    // 1er accusé : le développeur a effectué la modification
    devCheck: {
        type: Boolean,
        default: false
    },
    devCheckAt: {
        type: Date
    },
    // 2e accusé : l'utilisateur a constaté la modification
    userCheck: {
        type: Boolean,
        default: false
    },
    userCheckAt: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Request', requestSchema);
module.exports.CATEGORY_MIN_AMOUNT = CATEGORY_MIN_AMOUNT;
