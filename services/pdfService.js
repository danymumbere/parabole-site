const puppeteer = require('puppeteer');
const fs = require('fs'); // Ajout du module 'fs' pour lire les fichiers locaux

// Fonction utilitaire pour convertir une image locale en Base64
function imageToBase64(filePath) {
    try {
        const imageBuffer = fs.readFileSync(filePath);
        // On retourne la chaîne au format attendu par la balise <img>
        return `data:image/png;base64,${imageBuffer.toString('base64')}`;
    } catch (error) {
        console.error(`⚠️ Impossible de lire l'image : ${filePath}`, error);
        return ''; 
    }
}

async function createPDF(storyData, coverUrl, scenesWithImages, outputPath) {
    
    // 1. Conversion de l'image de couverture en Base64
    const coverBase64 = imageToBase64(coverUrl);

    // 2. Conversion des images des scènes en Base64 lors de la génération du HTML
    let scenesHtml = scenesWithImages.map(scene => {
        const sceneImageBase64 = imageToBase64(scene.imageUrl);
        return `
        <div class="scene">
            <p>${scene.texte}</p>
            <img src="${sceneImageBase64}" alt="Scene illustration" />
        </div>
        `;
    }).join('');

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <style>
            body { 
                font-family: 'Helvetica Neue', Arial, sans-serif; 
                color: #333; 
                margin: 0; 
                padding: 40px; 
                background-color: #FAFAFA; 
            }
            .cover { 
                text-align: center; 
                page-break-after: always; 
                display: flex; 
                flex-direction: column; 
                align-items: center; 
                justify-content: center; 
                height: 100vh; 
            }
            h1 { font-size: 3em; font-weight: 300; margin-bottom: 10px; }
            h3 { font-weight: normal; color: #666; }
            .cover img { 
                width: 100%; 
                max-height: 60vh; 
                object-fit: cover; 
                border-radius: 4px; 
                margin-top: 30px; 
            }
            .scene { page-break-after: always; margin-top: 50px; }
            .scene p { 
                font-size: 1.2em; 
                line-height: 1.6; 
                text-align: justify; 
                margin-bottom: 30px; 
            }
            .scene img { 
                width: 100%; 
                border-radius: 4px; 
                display: block; 
                margin: 0 auto; 
            }
        </style>
    </head>
    <body>
        <div class="cover">
            <h1>${storyData.titre}</h1>
            <h3>Inspiré de : ${storyData.verset}</h3>
            <img src="${coverBase64}" alt="Couverture" />
        </div>
        ${scenesHtml}
    </body>
    </html>
    `;

    const browser = await puppeteer.launch({
        headless: "new", // ou true
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    await page.pdf({ path: outputPath, format: 'A4', printBackground: true });
    await browser.close();
    
    return outputPath;
}

module.exports = { createPDF };