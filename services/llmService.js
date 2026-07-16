const axios = require('axios');

async function generateStory() {
    const themes = ["l'espoir", "le courage", "le pardon", "la patience", "la foi dans l'épreuve", "la joie partagée", "la fidélité"];
    const randomTheme = themes[Math.floor(Math.random() * themes.length)];

    const prompt = `Trouve un verset ou une séquence biblique intéressante ou inspirante. Ayant compris l'idée ou le message qui en découle, tu as comme objectif de transmettre cette idée, non par des mots, mais implicitement, par une histoire. Tu tentera de t'exprimer comme Jésus expliquait au moyen de paraboles.  
    IMPORTANT: Choisis un verset qui parle de : ${randomTheme}. 
    Le personnage principal DOIT avoir un nom original.
    Renvoie UNIQUEMENT un JSON strict avec cette structure :
    {
      "verset": "Référence du verset",
      "titre": "Titre de l'histoire",
      "consistance": {
        "personnagePrincipal": "Description physique en anglais, ex: 'A young man with short brown hair, wearing a simple blue jacket'",
        "lieuPrincipal": "Description en anglais",
        "objetCle": "Description en anglais"
      },
      "scenes": [
        { 
          "texte": "Narration de la scène en français...", 
          "imagePrompt": "Prompt en anglais incluant le personnagePrincipal. Full frame composition, modern minimalist graphic design, 2D flat illustration, not 3D." 
        }
      ]
    }`;

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, 
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 1.2, // De 0.0 (déterministe) à 2.0 (très chaotique). 1.0 ou 1.2 est idéal ici.
                    topP: 0.95,       // Favorise un vocabulaire plus varié
                    topK: 40          // Élargit le champ des concepts piochés
                }
            }
        );
        
        const rawText = response.data.candidates[0].content.parts[0].text;
        const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '');
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("Erreur LLM:", error);
        throw error;
    }
}

module.exports = { generateStory };