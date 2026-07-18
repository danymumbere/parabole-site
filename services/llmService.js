const axios = require('axios');

async function generateStory() {
    const themes = ["l'espoir", "le courage", "le pardon", "la patience", "la foi dans l'épreuve", "la joie partagée", "la fidélité"];
    const randomTheme = themes[Math.floor(Math.random() * themes.length)];

    const prompt = `Trouve un verset ou une séquence biblique intéressante ou inspirante. Ayant compris l'idée ou le message qui en découle, tu as comme objectif de transmettre cette idée implicitement par une histoire moderne. Tu le fera comme Jésus expliquait au moyen de paraboles.  
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
        console.log("Tentative de rédaction de l'histoire avec Gemini...");
        const apiKey = process.env.GEMINI_API_KEY;
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, 
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 1.2, 
                    topP: 0.95,       
                    topK: 40          
                }
            }
        );
        
        const rawText = response.data.candidates[0].content.parts[0].text;
        const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        console.log("✅ Histoire générée avec succès via Gemini !");
        return JSON.parse(jsonStr);

    } catch (error) {
        console.warn(`⚠️ Gemini indisponible (${error.message}). Basculement sur Pollinations.ai Text...`);
        
        try {
            // On renforce un peu le prompt pour s'assurer que le modèle open-source respecte le JSON
            const fallbackPrompt = prompt + " IMPORTANT: You must output ONLY valid JSON, no markdown formatting, no explanations.";
            const encodedPrompt = encodeURIComponent(fallbackPrompt);
            
            // L'API texte de Pollinations
            const url = `https://text.pollinations.ai/${encodedPrompt}`;
            
            const response = await axios.get(url);
            
            // Pollinations peut renvoyer directement un objet JSON ou une chaîne de caractères
            if (typeof response.data === 'object') {
                console.log("✅ Histoire générée avec succès via Pollinations.ai !");
                return response.data;
            } else {
                const jsonStr = response.data.replace(/```json/g, '').replace(/```/g, '').trim();
                console.log("✅ Histoire générée avec succès via Pollinations.ai !");
                return JSON.parse(jsonStr);
            }

        } catch (fallbackError) {
            console.error("❌ Erreur critique Pollinations Text:", fallbackError.message);
            throw new Error("Échec total de la génération de texte (Gemini et Pollinations inaccessibles).");
        }
    }
}

module.exports = { generateStory };