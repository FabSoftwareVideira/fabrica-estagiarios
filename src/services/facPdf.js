const fs = require('fs/promises');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { formatarDataBr } = require('../utils/datas');
const { mediaFac } = require('../utils/fac');

const TEMPLATE = path.join(__dirname, '../../docs/Ficha-de-Avaliacao-do-Estagiario-pela-Concedente.pdf');
const limpar = (texto) => String(texto ?? '').replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x09\x0a\x0d\x20-\u00ff]/g, '');

function linhas(texto, fonte, tamanho, largura) {
    const resultado = [];
    for (const paragrafo of limpar(texto).split(/\r?\n/)) {
        let linha = '';
        for (const caractere of paragrafo) {
            if (fonte.widthOfTextAtSize(linha + caractere, tamanho) > largura) {
                const espaco = linha.lastIndexOf(' ');
                if (espaco > 0) {
                    resultado.push(linha.slice(0, espaco));
                    linha = linha.slice(espaco + 1);
                } else { resultado.push(linha); linha = ''; }
            }
            linha += caractere;
        }
        resultado.push(linha);
    }
    return resultado;
}

async function gerarFacPdf({ aluno, fac }) {
    const doc = await PDFDocument.load(await fs.readFile(TEMPLATE));
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
    const [p1, p2] = doc.getPages();
    // Coordenadas em relação à prévia do modelo oficial (849 x 1200).
    const sx = p1.getWidth() / 849;
    const sy = p1.getHeight() / 1200;
    function linha(pagina, texto, x, base, largura, bold = false, tamanho = 10) {
        const conteudo = limpar(texto).replace(/\s+/g, ' ').trim();
        const font = bold ? negrito : fonte;
        while (tamanho > 5 && font.widthOfTextAtSize(conteudo, tamanho) > largura * sx) tamanho -= 0.25;
        pagina.drawText(conteudo, { x: x * sx, y: pagina.getHeight() - base * sy, font, size: tamanho });
    }
    function apagar(pagina, x, top, largura, altura) {
        pagina.drawRectangle({ x: x * sx, y: pagina.getHeight() - (top + altura) * sy,
            width: largura * sx, height: altura * sy, color: rgb(1, 1, 1) });
    }
    const continuacoes = [];
    function paragrafo(pagina, texto, x, top, largura, altura, titulo) {
        const tamanho = 9;
        const todas = linhas(texto, fonte, tamanho, largura * sx);
        const capacidade = Math.floor(altura * sy / 12);
        const extrapola = todas.length > capacidade;
        const visiveis = todas.splice(0, extrapola ? capacidade - 1 : capacidade);
        visiveis.forEach((t, i) => pagina.drawText(t, { x: x * sx,
            y: pagina.getHeight() - top * sy - i * 12, font: fonte, size: tamanho }));
        if (extrapola) {
            linha(pagina, '(Continua no anexo.)', x, top + visiveis.length * 12 / sy, largura, false, 8);
            continuacoes.push({ titulo, linhas: todas });
        }
    }
    linha(p1, aluno.nome, 323, 234, 460, true);
    linha(p1, fac.empresa, 366, 254, 417);
    linha(p1, fac.curso, 176, 274, 607);
    linha(p1, fac.periodo, 276, 294, 507);
    const bases = [443, 483, 523, 563, 603, 643, 672, 703, 743, 773];
    fac.notas.forEach((nota, i) => linha(p1, Number(nota).toFixed(1).replace('.', ','), 705, bases[i], 75, true, 11));
    linha(p1, mediaFac(fac.notas).toFixed(1).replace('.', ','), 705, 801, 75, true, 11);
    paragrafo(p1, fac.atividades, 118, 892, 663, 113, 'Principais atividades');
    paragrafo(p2, fac.comentarios, 118, 224, 640, 77, 'Comentários/observações');
    apagar(p2, 330, 343, 433, 30);
    linha(p2, `${fac.local_assinatura}, ${formatarDataBr(fac.data_assinatura)}`, 336, 364, 424);
    apagar(p2, 354, 447, 387, 20);
    linha(p2, fac.supervisor_nome, 355, 462, 382, true);
    apagar(p2, 302, 505, 458, 20);
    linha(p2, aluno.nome, 304, 520, 455, true);
    apagar(p2, 330, 612, 430, 20);
    linha(p2, aluno.orientador_nome || '', 333, 627, 427, true);

    // Não corta silenciosamente textos longos: o excedente vai para um anexo.
    for (const secao of continuacoes) {
        let pagina;
        let y = 0;
        for (const texto of secao.linhas) {
            if (y < 50) {
                pagina = doc.addPage([p1.getWidth(), p1.getHeight()]);
                pagina.drawText(`FAC - ${secao.titulo} (continuação)`, { x: 48, y: 790, font: negrito, size: 12 });
                linha(pagina, aluno.nome, 68, 100, 710, true);
                y = 750;
            }
            pagina.drawText(texto, { x: 48, y, font: fonte, size: 9 });
            y -= 12;
        }
    }
    return doc.save();
}
module.exports = { gerarFacPdf };
