// Geração dos PDFs a partir dos modelos em /docs: cada ficha precisa abrir,
// ter as páginas do modelo e aguentar textos longos e caracteres especiais.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { gerarFaaPdf, formatarDataBr } = require('../../src/services/faaPdf');
const { gerarFapoPdf } = require('../../src/services/fapoPdf');
const { gerarFarePdf } = require('../../src/services/farePdf');
const { gerarFichaAcompanhamentoPdf } = require('../../src/services/fichaAcompanhamentoPdf');

const textoLongo = 'Atividade “especial” – com travessão… e emoji 🌱 '.repeat(40) + 'PalavraMuitoLongaSemEspacoQueNaoCabeNaLinha'.repeat(5);
const abrir = async (bytes) => {
    assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
    return PDFDocument.load(bytes);
};

test('FAA: duas páginas, inclusive com textos longos e respostas desconhecidas', async () => {
    const pdf = await abrir(await gerarFaaPdf({
        aluno: { nome: 'Maria Antonieta de Alvarenga Peixoto Sobrinha da Silva Pereira' },
        empresa: textoLongo, periodo: '01/03/2026 a 30/09/2026', notas: [10, 9.5, 9, 8, 7, 6, 5, 4, 3, 0],
        atividades: textoLongo, respostas: ['sim', 'nao', 'mais_menos', 'sim', 'outra', undefined, 'nao'],
        comentarios: `${textoLongo}\n\nSegundo parágrafo`, dataAssinatura: '2026-11-12',
    }));
    assert.equal(pdf.getPageCount(), 2);
});

test('FAA: formatação de data aceita ISO, Date e texto qualquer', () => {
    assert.equal(formatarDataBr('2026-11-12'), '12/11/2026');
    assert.equal(formatarDataBr(new Date(2026, 10, 12, 12)), '12/11/2026');
    assert.equal(formatarDataBr('sem data'), 'sem data');
    assert.equal(formatarDataBr(''), '');
});

test('FAPO: gera com e sem comentários', async () => {
    for (const comentarios of ['', null, textoLongo]) {
        const pdf = await abrir(await gerarFapoPdf({ aluno: { nome: 'Ana Andrade' }, empresa: 'Agro Vale', nota: 8.75, comentarios, dataAssinatura: '2026-11-12' }));
        assert.ok(pdf.getPageCount() >= 1);
    }
});

test('ata da banca (FARE): resultado com ressalva e campos vazios', async () => {
    const banca = [[8, 8.5, 9], [10, 9, 9.5], [7, null, 7]];
    const comRessalva = await abrir(await gerarFarePdf({
        aluno: { nome: 'Ana Andrade', curso: 'Curso Técnico em Informática Integrado ao Ensino Médio', matricula: '2024001' },
        empresa: textoLongo, periodo: '01/03/2026 a 30/09/2026', horas: 240.5, fac: 8.3, fapo: 9, faa: 9.25, banca,
        avaliador1: 'Otto Outro', avaliador2: 'Saulo Supervisor', orientadorNome: 'Olga Orientadora',
        resultado: 'aprovado_ressalva', corrigirRelatorioAte: '2026-12-01', refazerApresentacaoAte: '2026-12-10',
        comentarios: textoLongo, dataAta: '2026-11-12',
    }));
    assert.ok(comRessalva.getPageCount() >= 1);

    // rascunho: quase tudo em branco
    await abrir(await gerarFarePdf({ aluno: { nome: 'Bruno' }, banca: [[null, null, null], [null, null, null], [null, null, null]], horas: 'x' }));
    for (const resultado of ['aprovado', 'reprovado']) {
        await abrir(await gerarFarePdf({ aluno: { nome: 'Bruno' }, banca, horas: 10, resultado, dataAta: '2026-11-12' }));
    }
});

test('ficha de acompanhamento: até 16 atividades, descrição cortada em 140 caracteres', async () => {
    const atividades = Array.from({ length: 20 }, (_, i) => ({
        data: new Date(2026, 9, i + 1), hora_inicio: '08:00:00', hora_fim: '12:00:00', horas: '4.00',
        descricao: i === 0 ? 'x'.repeat(200) : `Atividade ${i + 1}`, status_validacao: i === 19 ? 'pendente' : 'validada',
    }));
    const pdf = await abrir(await gerarFichaAcompanhamentoPdf({
        aluno: { nome: 'Ana Andrade', empresa: 'Agro Vale', supervisor_nome: 'Saulo Supervisor', orientador_nome: 'Olga Orientadora' },
        atividades,
    }));
    const form = pdf.getForm();
    assert.equal(form.getTextField('atividade_01').getText(), `${'x'.repeat(137)}...`);
    assert.equal(form.getTextField('atividade_16').getText(), 'Atividade 16');
    assert.equal(form.getTextField('horas_02').getText(), '4,00');
    assert.equal(form.getTextField('entrada_02').getText(), '08:00');
    // 19 validadas x 4h; a pendente fica de fora mesmo sem caber na tabela
    assert.equal(form.getTextField('total_horas_estagio').getText(), '76,00');
    assert.equal(form.getTextField('data_ultimo_dia').getText(), '19/10/2026');
});

test('ficha de acompanhamento sem atividades validadas fica com total zero', async () => {
    const pdf = await abrir(await gerarFichaAcompanhamentoPdf({ aluno: { nome: 'Carla' }, atividades: [] }));
    const form = pdf.getForm();
    assert.equal(form.getTextField('total_horas_estagio').getText(), '0,00');
    assert.equal(form.getTextField('empresa').getText() || '', '');
});
