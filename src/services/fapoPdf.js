const fs = require('fs/promises');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { formatarDataBr } = require('./faaPdf');

const TEMPLATE_PATH = path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'FAPO - Avaliação-Estágio-Professor Orientador.pdf'
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

function formatarNota(valor) {
    return Number(valor).toFixed(1).replace('.', ',');
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

async function gerarFapoPdf({ aluno, empresa, nota, comentarios, dataAssinatura }) {
    const templateBytes = await fs.readFile(TEMPLATE_PATH);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const negrito = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const [pagina] = pdfDoc.getPages();

    desenharLinha(pagina, aluno.nome, {
        x: 224,
        y: 598.6,
        larguraMaxima: 290,
        font: negrito,
        tamanho: 10.5,
    });

    desenharLinha(pagina, empresa, {
        x: 224,
        y: 584.2,
        larguraMaxima: 290,
        font,
        tamanho: 10.5,
    });

    const textoNota = formatarNota(nota);
    const larguraNota = negrito.widthOfTextAtSize(textoNota, 11);
    pagina.drawText(textoNota, {
        x: (388 + 491) / 2 - larguraNota / 2,
        y: 545,
        size: 11,
        font: negrito,
        color: PRETO,
    });

    const baselinesComentarios = [490.2, 475.5, 460.8, 446.1];
    const linhasComentarios = quebrarTexto(comentarios, font, 9.5, 444).slice(0, baselinesComentarios.length);
    linhasComentarios.forEach((linha, indice) => {
        if (!linha) return;
        pagina.drawText(linha, {
            x: 68,
            y: baselinesComentarios[indice],
            size: 9.5,
            font,
            color: PRETO,
        });
    });

    const textoData = `Orientador(a), em ${formatarDataBr(dataAssinatura)}`;
    pagina.drawRectangle({
        x: 205,
        y: 372,
        width: 190,
        height: 18,
        color: BRANCO,
    });
    const larguraData = negrito.widthOfTextAtSize(textoData, 11.5);
    pagina.drawText(textoData, {
        x: (205 + 395) / 2 - larguraData / 2,
        y: 376.8,
        size: 11.5,
        font: negrito,
        color: PRETO,
    });

    return pdfDoc.save();
}

module.exports = { gerarFapoPdf };
