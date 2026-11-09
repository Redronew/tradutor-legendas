const express = require('express');
const multer = require('multer');
const { translate } = require('@vitalets/google-translate-api');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const crc32 = require('buffer-crc32');

const app = express();
const port = process.env.PORT || 3000;

// --- CONEXÃO COM O SUPABASE ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Variáveis do PayPal
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_API = 'https://api-m.paypal.com'; // Use 'https://api-m.sandbox.paypal.com' para testes

// =====================================================================
// 1. ROTA DO WEBHOOK DO PAYPAL (DEVE SER A PRIMEIRA!)
// O express.raw garante que o corpo chegue intacto para a verificação
// =====================================================================
app.post('/webhook-paypal', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const rawBody = req.body.toString('utf8');
        const headers = req.headers;
        
        // Verificação de segurança (Assinatura)
        const transmissionId = headers['paypal-transmission-id'];
        const transmissionTime = headers['paypal-transmission-time'];
        const certUrl = headers['paypal-cert-url'];
        const transmissionSig = headers['paypal-transmission-sig'];
        const authAlgo = headers['paypal-auth-algo'];

        if (!transmissionId) {
            console.error('Cabeçalhos ausentes no webhook.');
            return res.status(400).send('Cabeçalhos ausentes');
        }

        const bodyCrc = crc32.unsigned(rawBody);
        const message = `${transmissionId}|${transmissionTime}|${PAYPAL_WEBHOOK_ID}|${bodyCrc}`;

        const certResponse = await fetch(certUrl);
        const cert = await certResponse.text();
        
        // Tradução do algoritmo do PayPal para o Node.js
        const algoritmoNode = authAlgo === 'SHA256withRSA' ? 'RSA-SHA256' : authAlgo;
        const verifier = crypto.createVerify(algoritmoNode);
        verifier.update(message);
        const isValid = verifier.verify(cert, transmissionSig, 'base64');

        if (!isValid) {
            console.error('Assinatura do webhook inválida.');
            return res.status(400).send('Assinatura inválida');
        }

        // Processar a doação se a assinatura for válida
        const event = JSON.parse(rawBody);
        if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
            const amount = parseFloat(event.resource.amount.value);
            
            console.log(`Doação recebida via PayPal: ${amount}`);
            
            // Pega o total atual do Supabase
            const { data, error } = await supabase.from('doacoes').select('total').eq('id', 1).single();
            if (error) throw error;
            
            // Atualiza o total
            const novoTotal = (data.total || 0) + amount;
            const { error: updateError } = await supabase.from('doacoes').update({ total: novoTotal, atualizado_em: new Date() }).eq('id', 1);
            if (updateError) throw updateError;
            
            console.log(`Novo total atualizado no banco: ${novoTotal}`);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Erro no processamento do webhook:', error);
        res.status(500).send('Erro interno');
    }
});

// =====================================================================
// 2. MIDDLEWARES E OUTRAS ROTAS
// =====================================================================
app.use(express.static('public'));

// Rota para o protótipo do app
app.get('/app', (req, res) => {
    res.sendFile(__dirname + '/public/app.html');
});

const upload = multer({ storage: multer.memoryStorage() });

// Rota de tradução
app.post('/traduzir', upload.single('legenda'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });

        const extensao = path.extname(req.file.originalname).toLowerCase();
        const formatosSuportados = ['.srt', '.vtt', '.ass'];
        if (!formatosSuportados.includes(extensao)) return res.status(400).json({ erro: 'Formato inválido.' });

        let conteudo = req.file.buffer.toString('utf-8');
        const idiomaDestino = req.body.idiomaDestino || 'pt';
        let srtFinal = "";
        let textoBruto = "";

        if (extensao === '.srt' || extensao === '.vtt') {
            const blocos = conteudo.trim().split(/\n\s*\n/);
            const textosParaTraduzir = [];
            blocos.forEach(bloco => {
                const linhas = bloco.split('\n');
                if (linhas[0].trim().startsWith('WEBVTT')) { srtFinal += linhas[0] + '\n\n'; return; }
                let tempoIndex = linhas.findIndex(l => l.includes('-->'));
                if (tempoIndex === -1) return;
                const texto = linhas.slice(tempoIndex + 1).join(' ');
                if (texto) textosParaTraduzir.push(texto);
            });

            textoBruto = textosParaTraduzir.join(' ||| ');
            const resultado = await translate(textoBruto, { to: idiomaDestino });
            const textosTraduzidosArray = resultado.text.split(' ||| ');

            let contador = 0;
            blocos.forEach(bloco => {
                const linhas = bloco.split('\n');
                if (linhas[0].trim().startsWith('WEBVTT')) return;
                let tempoIndex = linhas.findIndex(l => l.includes('-->'));
                if (tempoIndex === -1) return;
                const tempo = linhas[tempoIndex];
                const textoNovo = textosTraduzidosArray[contador] || linhas.slice(tempoIndex + 1).join(' ');
                srtFinal += (extensao === '.srt') ? `${contador + 1}\n${tempo}\n${textoNovo}\n\n` : `${tempo}\n${textoNovo}\n\n`;
                contador++;
            });

        } else if (extensao === '.ass') {
            const linhas = conteudo.split('\n');
            const linhasParaTraduzir = []; const indicesParaTraduzir = [];
            linhas.forEach((linha, index) => {
                if (linha.startsWith('Dialogue:')) {
                    const partes = linha.split(',');
                    if (partes.length >= 10) { linhasParaTraduzir.push(partes.slice(9).join(',')); indicesParaTraduzir.push(index); }
                }
            });
            textoBruto = linhasParaTraduzir.join(' ||| ');
            const resultado = await translate(textoBruto, { to: idiomaDestino });
            const textosTraduzidosArray = resultado.text.split(' ||| ');
            const novaLinha = [...linhas];
            indicesParaTraduzir.forEach((lineIndex, arrayIndex) => {
                const partes = novaLinha[lineIndex].split(',');
                novaLinha[lineIndex] = `${partes.slice(0, 9).join(',')},${textosTraduzidosArray[arrayIndex]}`;
            });
            srtFinal = novaLinha.join('\n');
        }
        res.json({ srtTraduzido: srtFinal });
    } catch (error) {
        console.error("Erro na tradução:", error.message);
        res.status(500).json({ erro: 'Erro ao traduzir o arquivo.' });
    }
});

// Rota para o frontend consultar o total
app.get('/api/total-doado', async (req, res) => {
    try {
        const { data, error } = await supabase.from('doacoes').select('total').eq('id', 1).single();
        if (error) throw error;
        res.json({ total: data.total || 0, meta: 200 });
    } catch (error) {
        console.error('Erro ao buscar total:', error);
        res.status(500).json({ erro: 'Erro ao buscar total' });
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});