const express = require('express');
const multer = require('multer');
const { translate } = require('@vitalets/google-translate-api');
const app = express();
const port = 3000;

app.use(express.static('public'));
const upload = multer({ storage: multer.memoryStorage() });

app.post('/traduzir', upload.single('legenda'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
        }

        if (!req.file.originalname.endsWith('.srt')) {
            return res.status(400).json({ erro: 'Formato inválido. Envie apenas .srt' });
        }

        let srtContent = req.file.buffer.toString('utf-8');
        
        // AQUI ESTÁ O PULO DO GATO: Lendo o idioma que o front-end envia
        const idiomaDestino = req.body.idiomaDestino || 'pt';
        
        // ESSA MENSAGEM TEM QUE APARECER NO TERMINAL
        console.log(`\n--- NOVA REQUISIÇÃO ---`);
        console.log(`Arquivo: ${req.file.originalname}`);
        console.log(`Idioma escolhido: ${idiomaDestino}`);

        const blocos = srtContent.trim().split(/\n\s*\n/);
        const textosParaTraduzir = [];
        
        blocos.forEach(bloco => {
            const linhas = bloco.split('\n');
            const texto = linhas.slice(2).join(' '); 
            if (texto) textosParaTraduzir.push(texto);
        });

        const textoBruto = textosParaTraduzir.join(' ||| ');
        
        // Chama a API passando o idioma escolhido
        const resultado = await translate(textoBruto, { to: idiomaDestino });
        const textoTraduzido = resultado.text;

        const textosTraduzidosArray = textoTraduzido.split(' ||| ');
        let srtFinal = "";

        blocos.forEach((bloco, index) => {
            const linhas = bloco.split('\n');
            const id = linhas[0];
            const tempo = linhas[1];
            const textoOriginal = linhas.slice(2).join(' ');
            const textoNovo = textosTraduzidosArray[index] || textoOriginal; 

            srtFinal += `${id}\n${tempo}\n${textoNovo}\n\n`;
        });

        console.log("Tradução concluída com sucesso!");
        res.json({ srtTraduzido: srtFinal });

    } catch (error) {
        console.error("Erro na tradução:", error.message);
        res.status(500).json({ erro: 'Erro ao traduzir o arquivo.' });
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});