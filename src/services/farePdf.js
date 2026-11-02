const fs = require('fs/promises');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { formatarDataBr } = require('../utils/datas');
const { calcularAta, formatarNotaBr } = require('../utils/ata');

const DOCS_DIR = path.join(__dirname, '..', '..', 'docs');

const PRETO = rgb(0, 0, 0);
const BRANCO = rgb(1, 1, 1);
const VERDE_ESCURO = rgb(0.3098, 0.3843, 0.1569);
const VERDE_BORDA = rgb(0.6078, 0.7333, 0.349);

// o nome do arquivo tem acentos e pode variar entre sistemas/zip: procura
// pelo prefixo em vez de depender da grafia exata
async function lerTemplate() {
    const arquivos = await fs.readdir(DOCS_DIR);
    const nome = arquivos.find((a) => a.toUpperCase().startsWith('FARE') && a.toLowerCase().endsWith('.pdf'));
    if (!nome) throw new Error('Modelo da FARE não encontrado em /docs.');
    return fs.readFile(path.join(DOCS_DIR, nome));
}

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
                while (corte > 1 && font.widthOfTextAtSize(palavra.slice(0, corte), tamanho) > larguraMaxima) corte -= 1;
                linhas.push(palavra.slice(0, corte));
                palavra = palavra.slice(corte);
            }
            linha = palavra;
        });
        if (linha) linhas.push(linha);
    });
    return linhas;
}

// reduz a fonte (ou corta com "...") até o texto caber na largura
function ajustar(texto, font, tamanho, larguraMaxima, tamanhoMinimo = 7) {
    let conteudo = sanitizar(texto).replace(/\s+/g, ' ').trim();
    let t = tamanho;
    while (t > tamanhoMinimo && font.widthOfTextAtSize(conteudo, t) > larguraMaxima) t -= 0.5;
    if (font.widthOfTextAtSize(conteudo, t) > larguraMaxima) {
        while (conteudo.length > 1 && font.widthOfTextAtSize(`${conteudo}...`, t) > larguraMaxima) {
            conteudo = conteudo.slice(0, -1);
        }
        conteudo += '...';
    }
    return { conteudo, tamanho: t };
}

function formatarHoras(horas) {
    const n = Number(horas);
    if (!Number.isFinite(n)) return '';
    return String(Number(n.toFixed(2))).replace('.', ',');
}

async function gerarFarePdf({
    aluno,
    empresa,
    periodo,
    horas,
    fac,
    fapo,
    faa,
    banca,
    avaliador1,
    avaliador2,
    orientadorNome,
    resultado,
    corrigirRelatorioAte,
    refazerApresentacaoAte,
    comentarios,
    dataAta,
}) {
    const pdfDoc = await PDFDocument.load(await lerTemplate());
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const negrito = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const [pagina] = pdfDoc.getPages();
    const alturaPagina = pagina.getHeight();

    // as medidas abaixo vêm do modelo, com a origem no topo da página
    const y = (topo) => alturaPagina - topo;

    const texto = (valor, { x, base, font: f = font, tamanho = 10.5, cor = PRETO }) => {
        if (!valor) return;
        pagina.drawText(sanitizar(valor), { x, y: y(base), size: tamanho, font: f, color: cor });
    };

    const centralizado = (valor, { x0, x1, base, font: f = font, tamanho = 10.5, cor = PRETO }) => {
        const limpo = sanitizar(valor);
        if (!limpo) return;
        const largura = f.widthOfTextAtSize(limpo, tamanho);
        pagina.drawText(limpo, { x: (x0 + x1) / 2 - largura / 2, y: y(base), size: tamanho, font: f, color: cor });
    };

    // texto no meio de uma linha da tabela [topo, base]
    const naCelula = (valor, x0, x1, linha, opcoes = {}) => {
        const tamanho = opcoes.tamanho || 10.5;
        centralizado(valor, { x0, x1, base: (linha[0] + linha[1]) / 2 + tamanho * 0.35, tamanho, font: opcoes.font });
    };

    // ── Frase de abertura (escreve sobre os traços) ────────────────────
    const campo = (valor, x, ate, base, f = font) => {
        const { conteudo, tamanho } = ajustar(valor, f, 10.5, ate - x - 2);
        texto(conteudo, { x: x + 1, base, font: f, tamanho });
    };
    campo(aluno.nome, 221, 487, 216.3, negrito);
    campo(empresa, 121, 479, 230.8);
    campo(periodo, 73, 303, 245.3);
    campo(formatarHoras(horas), 371, 417, 245.3, negrito);

    // ── Tabela de notas ───────────────────────────────────────────────
    const calculo = calcularAta({ fac, fapo, faa, banca });
    const COL_NOTA = [358.1, 433.7];
    const COL_PONTOS = [433.7, 510.6];
    const COL_N = [[358.1, 383.8], [383.8, 408.7], [408.7, 433.7]];
    const L_FAC = [325.8, 340.9];
    const L_FAPO = [340.9, 356.0];
    const L_BANCA = [[412.1, 427.1], [427.1, 442.2], [442.2, 457.3]];
    const L_FAA = [473.0, 488.1];
    const CHAVES_BANCA = ['apresentacao', 'pratica', 'relatorio'];

    const linhaSimples = (chave, linha, casasNota) => {
        const l = calculo.linhas[chave];
        if (l.nota === null) return;
        naCelula(formatarNotaBr(l.nota, casasNota), COL_NOTA[0], COL_NOTA[1], linha);
        naCelula(formatarNotaBr(l.pontos, 2), COL_PONTOS[0], COL_PONTOS[1], linha);
    };
    linhaSimples('fac', L_FAC, 1);
    linhaSimples('fapo', L_FAPO, 1);
    linhaSimples('faa', L_FAA, 2);

    CHAVES_BANCA.forEach((chave, i) => {
        (banca[i] || []).forEach((nota, j) => {
            naCelula(formatarNotaBr(nota, 1), COL_N[j][0], COL_N[j][1], L_BANCA[i]);
        });
        naCelula(formatarNotaBr(calculo.linhas[chave].nota, 2), COL_PONTOS[0], COL_PONTOS[1], L_BANCA[i]);
    });

    // nota final: cobre o "0,00" do modelo
    pagina.drawRectangle({ x: 436, y: y(517.5), width: 73, height: 27, color: VERDE_ESCURO });
    centralizado(formatarNotaBr(calculo.final, 2), {
        x0: COL_PONTOS[0], x1: COL_PONTOS[1], base: 507.3, font: negrito, tamanho: 11.5, cor: BRANCO,
    });

    // ── Resultado ─────────────────────────────────────────────────────
    const marcar = (cx, base) => {
        const larg = negrito.widthOfTextAtSize('X', 10.5);
        pagina.drawText('X', { x: cx - larg / 2, y: y(base), size: 10.5, font: negrito, color: PRETO });
    };
    if (resultado === 'aprovado') marcar(99.5, 556.0);
    if (resultado === 'aprovado_ressalva') marcar(99.5, 568.6);
    if (resultado === 'reprovado') marcar(99.5, 606.6);

    const data = (iso, xTraco, xFim, topo, base) => {
        if (!iso) return;
        pagina.drawRectangle({ x: xTraco - 0.5, y: y(topo + 12.3), width: xFim - xTraco + 1, height: 12.3, color: BRANCO });
        texto(formatarDataBr(iso), { x: xTraco + 2, base, tamanho: 10.5, font: negrito });
    };
    if (resultado === 'aprovado_ressalva') {
        if (corrigirRelatorioAte) {
            marcar(135.5, 581.0);
            data(corrigirRelatorioAte, 350.6, 417.9, 571.3, 581.3);
        }
        if (refazerApresentacaoAte) {
            marcar(135.5, 593.7);
            data(refazerApresentacaoAte, 369.0, 436.3, 584.0, 593.95);
        }
    }

    // ── Comentários (2 linhas no quadro; passando disso, estende o quadro) ─
    const tamanhoComentario = 9.5;
    const linhasComentarios = quebrarTexto(comentarios, font, tamanhoComentario, 420).slice(0, 4);
    const bases = [645.4, 659.8, 674.2, 688.6];
    if (linhasComentarios.length > 2) {
        const fundo = linhasComentarios.length === 3 ? 679.0 : 693.4;
        const opcoes = { thickness: 1, color: VERDE_BORDA };
        pagina.drawRectangle({ x: 78.5, y: y(665.2), width: 431, height: 2, color: BRANCO });
        pagina.drawLine({ start: { x: 78, y: y(664.3) }, end: { x: 78, y: y(fundo) }, ...opcoes });
        pagina.drawLine({ start: { x: 510.3, y: y(664.3) }, end: { x: 510.3, y: y(fundo) }, ...opcoes });
        pagina.drawLine({ start: { x: 77.5, y: y(fundo) }, end: { x: 510.8, y: y(fundo) }, ...opcoes });
    }
    linhasComentarios.forEach((linha, i) => texto(linha, { x: 82, base: bases[i], tamanho: tamanhoComentario }));

    // ── Assinaturas ───────────────────────────────────────────────────
    const nomeAvaliador = (nome, xRotulo0, xRotulo1, centro) => {
        pagina.drawRectangle({ x: xRotulo0, y: y(715), width: xRotulo1 - xRotulo0, height: 13, color: BRANCO });
        const { conteudo, tamanho } = ajustar(nome, font, 10.5, 158);
        centralizado(conteudo, { x0: centro - 90, x1: centro + 90, base: 712.2, tamanho });
    };
    if (avaliador1) nomeAvaliador(avaliador1, 79, 188, 132.8);
    if (avaliador2) nomeAvaliador(avaliador2, 404, 514, 458.7);

    const textoData = `Orientador(a), em ${dataAta ? formatarDataBr(dataAta) : '___/___/ 20__'}`;
    pagina.drawRectangle({ x: 205, y: y(753.5), width: 190, height: 14, color: BRANCO });
    centralizado(textoData, { x0: 205, x1: 395, base: 750.4, font: negrito, tamanho: 11 });
    if (orientadorNome) {
        const { conteudo, tamanho } = ajustar(orientadorNome, font, 10, 220);
        centralizado(conteudo, { x0: 185, x1: 405, base: 764.5, tamanho });
    }

    return pdfDoc.save();
}

module.exports = { gerarFarePdf };
