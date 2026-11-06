const express = require('express');
const multer = require('multer');
const { translate } = require('@vitalets/google-translate-api');
const path = require('path'); // Importante para pegar a extensão do arquivo
const app = express();
const port = 3000;

app.use(express.static('public'));

// --- NOVA ROTA PARA O PROTÓTIPO DO APP ---
app.get('/app', (req, res) => {
    res.sendFile(__dirname + '/public/app.html');
});

const upload = multer({ storage: multer.memoryStorage() });

app.post('/traduzir', upload.single('legenda'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
        }

        const extensao = path.extname(req.file.originalname).toLowerCase();
        const formatosSuportados = ['.srt', '.vtt', '.ass'];

        if (!formatosSuportados.includes(extensao)) {
            return res.status(400).json({ erro: 'Formato inválido. Envie .srt, .vtt ou .ass' });
        }

        let conteudo = req.file.buffer.toString('utf-8');
        const idiomaDestino = req.body.idiomaDestino || 'pt';
        
        console.log(`\n--- NOVA REQUISIÇÃO ---`);
        console.log(`Arquivo: ${req.file.originalname}`);
        console.log(`Idioma escolhido: ${idiomaDestino}`);

        let srtFinal = "";
        let textoBruto = "";

        if (extensao === '.srt' || extensao === '.vtt') {
            // Lógica para SRT e VTT
            const blocos = conteudo.trim().split(/\n\s*\n/);
            const textosParaTraduzir = [];
            
            blocos.forEach(bloco => {
                const linhas = bloco.split('\n');
                // Pula o cabeçalho do VTT se existir
                if (linhas[0].trim().startsWith('WEBVTT')) {
                    srtFinal += linhas[0] + '\n\n';
                    return;
                }
                
                // Encontra a linha do tempo (contém '-->')
                let tempoIndex = linhas.findIndex(l => l.includes('-->'));
                if (tempoIndex === -1) return; // Se não tem tempo, não é uma legenda válida
                
                // O texto é tudo o que vem depois da linha do tempo
                const texto = linhas.slice(tempoIndex + 1).join(' ');
                if (texto) textosParaTraduzir.push(texto);
            });

            textoBruto = textosParaTraduzir.join(' ||| ');
            const resultado = await translate(textoBruto, { to: idiomaDestino });
            const textoTraduzido = resultado.text;
            const textosTraduzidosArray = textoTraduzido.split(' ||| ');

            // Remonta o arquivo
            let contador = 0;
            blocos.forEach(bloco => {
                const linhas = bloco.split('\n');
                if (linhas[0].trim().startsWith('WEBVTT')) return; 

                let tempoIndex = linhas.findIndex(l => l.includes('-->'));
                if (tempoIndex === -1) return;

                const tempo = linhas[tempoIndex];
                const textoNovo = textosTraduzidosArray[contador] || linhas.slice(tempoIndex + 1).join(' ');
                
                if (extensao === '.srt') {
                    srtFinal += `${contador + 1}\n${tempo}\n${textoNovo}\n\n`;
                } else {
                    // Formato VTT não usa números sequenciais na frente
                    srtFinal += `${tempo}\n${textoNovo}\n\n`;
                }
                contador++;
            });

        } else if (extensao === '.ass') {
            // Lógica para ASS (mais complexa, usa vírgulas)
            const linhas = conteudo.split('\n');
            const linhasParaTraduzir = [];
            const indicesParaTraduzir = [];

            linhas.forEach((linha, index) => {
                if (linha.startsWith('Dialogue:')) {
                    // O texto no ASS fica após a 9ª vírgula
                    const partes = linha.split(',');
                    if (partes.length >= 10) {
                        const textoOriginal = partes.slice(9).join(',');
                        linhasParaTraduzir.push(textoOriginal);
                        indicesParaTraduzir.push(index);
                    }
                }
            });

            textoBruto = linhasParaTraduzir.join(' ||| ');
            const resultado = await translate(textoBruto, { to: idiomaDestino });
            const textosTraduzidosArray = resultado.text.split(' ||| ');

            // Substitui de volta
            const novaLinha = [...linhas];
            indicesParaTraduzir.forEach((lineIndex, arrayIndex) => {
                const partes = novaLinha[lineIndex].split(',');
                const inicio = partes.slice(0, 9).join(',');
                novaLinha[lineIndex] = `${inicio},${textosTraduzidosArray[arrayIndex]}`;
            });
            srtFinal = novaLinha.join('\n');
        }

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