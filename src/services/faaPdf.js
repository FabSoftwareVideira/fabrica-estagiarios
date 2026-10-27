const fs = require('fs/promises');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const TEMPLATE_PATH = path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'FAA - Ficha de auto avaliação de estagiário.pdf'
);

const PRETO = rgb(0, 0, 0);
const BRANCO = rgb(1, 1, 1);

function sanitizar(texto) {
    return String(texto || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
        .replace(/[^\x09\x0a\x0d\x20-\u00ff]/g, '');
}

function formatarDataBr(valor) {
    if (!valor) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        const [ano, mes, dia] = valor.split('-');
        return `${dia}/${mes}/${ano}`;
    }
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return String(valor);
    return data.toLocaleDateString('pt-BR');
}

function formatarNota(valor) {
    return Number(valor).toFixed(1).replace('.', ',');
}

function formatarMedia(valor) {
    return Number(valor).toFixed(2).replace('.', ',');
}

function quebrarTexto(texto, font, tamanho, larguraMaxima) {
    const linhas = [];

    sanitizar(texto).split(/\r?\n/).forEach((paragrafo) => {
        const palavras = paragrafo.trim().split(/\s+/).filter(Boolean);

        if (palavras.length === 0) {
            linhas.push('');
            return;
        }

        let linha = '';

        palavras.forEach((palavraOriginal) => {
            let palavra = palavraOriginal;
            const teste = linha ? `${linha} ${palavra}` : palavra;

            if (font.widthOfTextAtSize(teste, tamanho) <= larguraMaxima) {
                linha = teste;
                return;
            }

            if (linha) {
                linhas.push(linha);
                linha = '';
            }

            while (font.widthOfTextAtSize(palavra, tamanho) > larguraMaxima) {
                let corte = palavra.length;
                while (corte > 1 && font.widthOfTextAtSize(palavra.slice(0, corte), tamanho) > larguraMaxima) {
                    corte -= 1;
                }
                linhas.push(palavra.slice(0, corte));
                palavra = palavra.slice(corte);
            }

            linha = palavra;
        });

        if (linha) linhas.push(linha);
    });

    return linhas;
}

function desenharLinha(page, texto, { x, y, larguraMaxima, font, tamanho = 11, tamanhoMinimo = 7 }) {
    let conteudo = sanitizar(texto).replace(/\s+/g, ' ').trim();
    if (!conteudo) return;

    let fonteTamanho = tamanho;
    while (fonteTamanho > tamanhoMinimo && font.widthOfTextAtSize(conteudo, fonteTamanho) > larguraMaxima) {
        fonteTamanho -= 0.5;
    }

    if (font.widthOfTextAtSize(conteudo, fonteTamanho) > larguraMaxima) {
        while (conteudo.length > 1 && font.widthOfTextAtSize(`${conteudo}...`, fonteTamanho) > larguraMaxima) {
            conteudo = conteudo.slice(0, -1);
        }
        conteudo += '...';
    }

    page.drawText(conteudo, { x, y, size: fonteTamanho, font, color: PRETO });
}

function desenharCaixa(page, texto, { x, topo, largura, altura, font, tamanho = 9.5, tamanhoMinimo = 7 }) {
    let fonteTamanho = tamanho;
    let linhas = [];

    while (fonteTamanho >= tamanhoMinimo) {
        linhas = quebrarTexto(texto, font, fonteTamanho, largura);
        const entrelinha = fonteTamanho * 1.25;
        if (linhas.length * entrelinha <= altura) break;
        fonteTamanho -= 0.5;
    }

    const entrelinha = fonteTamanho * 1.25;
    const maxLinhas = Math.max(1, Math.floor(altura / entrelinha));

    if (linhas.length > maxLinhas) {
        linhas = linhas.slice(0, maxLinhas);
        let ultima = linhas[linhas.length - 1];
        while (ultima.length > 1 && font.widthOfTextAtSize(`${ultima}...`, fonteTamanho) > largura) {
            ultima = ultima.slice(0, -1);
        }
        linhas[linhas.length - 1] = `${ultima}...`;
    }

    linhas.forEach((linha, indice) => {
        if (!linha) return;
        page.drawText(linha, {
            x,
            y: topo - fonteTamanho * 0.85 - indice * entrelinha,
            size: fonteTamanho,
            font,
            color: PRETO,
        });
    });
}

function desenharNaCelula(page, texto, { x0, x1, centroYTopo, font, tamanho = 12 }) {
    const largura = font.widthOfTextAtSize(texto, tamanho);
    const centroX = (x0 + x1) / 2;
    page.drawText(texto, {
        x: centroX - largura / 2,
        y: page.getHeight() - centroYTopo - tamanho * 0.35,
        size: tamanho,
        font,
        color: PRETO,
    });
}

async function gerarFaaPdf({ aluno, empresa, periodo, notas, atividades, respostas, comentarios, dataAssinatura }) {
    const templateBytes = await fs.readFile(TEMPLATE_PATH);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const negrito = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const [pagina1, pagina2] = pdfDoc.getPages();
    const alturaPagina = pagina1.getHeight();

    // ── Cabeçalho (página 1) ─────────────────────────────────────────────
    desenharLinha(pagina1, aluno.nome, {
        x: 91.1,
        y: alturaPagina - 200,
        larguraMaxima: 295,
        font: negrito,
        tamanho: 11,
    });

    desenharLinha(pagina1, empresa, {
        x: 261.1,
        y: alturaPagina - 228,
        larguraMaxima: 265,
        font,
        tamanho: 10.5,
    });

    desenharLinha(pagina1, periodo, {
        x: 205,
        y: alturaPagina - 255,
        larguraMaxima: 300,
        font,
        tamanho: 10.5,
    });

    // ── Notas dos critérios ──────────────────────────────────────────────
    const linhasNotas = [
        { pagina: pagina1, centroYTopo: 431.75 },
        { pagina: pagina1, centroYTopo: 473.65 },
        { pagina: pagina1, centroYTopo: 515.55 },
        { pagina: pagina1, centroYTopo: 550.55 },
        { pagina: pagina1, centroYTopo: 585.55 },
        { pagina: pagina1, centroYTopo: 627.95 },
        { pagina: pagina1, centroYTopo: 649.15 },
        { pagina: pagina1, centroYTopo: 677.25 },
        { pagina: pagina1, centroYTopo: 712.25 },
        { pagina: pagina2, centroYTopo: 131.75 },
    ];

    linhasNotas.forEach((linha, indice) => {
        desenharNaCelula(linha.pagina, formatarNota(notas[indice]), {
            x0: 461.2,
            x1: 536.9,
            centroYTopo: linha.centroYTopo,
            font: negrito,
            tamanho: 12,
        });
    });

    const media = notas.reduce((soma, nota) => soma + Number(nota), 0) / notas.length;
    desenharNaCelula(pagina2, formatarMedia(media), {
        x0: 461.2,
        x1: 536.9,
        centroYTopo: 146.05,
        font: negrito,
        tamanho: 12,
    });

    // ── Atividades executadas (página 2) ─────────────────────────────────
    desenharCaixa(pagina2, atividades, {
        x: 91.1,
        topo: alturaPagina - 172,
        largura: 438,
        altura: 62,
        font,
        tamanho: 9.5,
    });

    // ── Avaliação do estágio e do curso (página 2) ───────────────────────
    const linhasQuestoes = [295.2, 309.65, 323.95, 338.25, 352.55, 366.85, 381.15];
    const colunasRespostas = {
        sim: { x0: 431.5, x1: 463.8 },
        nao: { x0: 463.8, x1: 496.2 },
        mais_menos: { x0: 496.2, x1: 528.5 },
    };

    respostas.forEach((resposta, indice) => {
        const coluna = colunasRespostas[resposta];
        if (!coluna) return;

        desenharNaCelula(pagina2, 'X', {
            x0: coluna.x0,
            x1: coluna.x1,
            centroYTopo: linhasQuestoes[indice],
            font: negrito,
            tamanho: 11,
        });
    });

    // ── Comentários/observações (página 2) ───────────────────────────────
    desenharCaixa(pagina2, comentarios, {
        x: 93.8,
        topo: alturaPagina - 419,
        largura: 434,
        altura: 102,
        font,
        tamanho: 9.5,
    });

    // ── Data da assinatura (página 2) ────────────────────────────────────
    const textoData = `Estagiário(a), em ${formatarDataBr(dataAssinatura)}`;
    pagina2.drawRectangle({
        x: 205,
        y: alturaPagina - 593,
        width: 190,
        height: 16,
        color: BRANCO,
    });
    desenharLinha(pagina2, textoData, {
        x: 207.7,
        y: alturaPagina - 588.5,
        larguraMaxima: 185,
        font: negrito,
        tamanho: 10.5,
    });

    return pdfDoc.save();
}

module.exports = { gerarFaaPdf };
