// Área do estagiário: cadastro inicial, registro de atividades e fichas.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { criarAmbiente, PESSOAS, CURSO } = require('./helpers/ambiente');
const atividades = require('../src/models/atividades');
const faposModel = require('../src/models/fapos');
const facsModel = require('../src/models/facs');
const faresModel = require('../src/models/fares');

let amb;
const { ana, bruno, davi, eva, fabio, orientadora } = PESSOAS;

before(async () => { amb = await criarAmbiente(); });
beforeEach(async () => { await amb.semear(); });
after(async () => { await amb.fechar(); });

async function pdf(resposta) {
    assert.equal(resposta.status, 200);
    assert.equal(resposta.headers.get('content-type'), 'application/pdf');
    const bytes = Buffer.from(await resposta.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    return PDFDocument.load(bytes);
}

const nomeDoArquivo = (resposta) => /filename="([^"]+)"/.exec(resposta.headers.get('content-disposition') || '')?.[1];

// ── Acesso ─────────────────────────────────────────────────────────────────
test('só estudantes entram na área /aluno; quem não entrou vai para o login', async () => {
    assert.equal((await amb.pedir('/aluno/dashboard')).local, '/login');
    assert.equal((await amb.pedir('/aluno/dashboard', { como: orientadora })).local, '/professor/dashboard');
    const painel = await amb.pedir('/aluno/dashboard', { como: ana });
    assert.equal(painel.status, 200);
    assert.match(await painel.text(), /Ana Andrade/);
    assert.equal((await amb.pedir('/aluno/atividades', { como: ana })).local, '/aluno/dashboard?aba=atividades');
});

test('conta desativada perde a sessão no próximo acesso', async () => {
    await amb.sql('UPDATE usuarios SET ativo = false WHERE id = $1', [ana]);
    const resposta = await amb.pedir('/aluno/dashboard', { como: ana });
    assert.equal(resposta.status, 403);
    assert.equal(amb.sessoes.has(`u${ana}`), false);
});

// ── Completar cadastro ────────────────────────────────────────────────────
test('completar cadastro: curso obrigatório, matrícula e avatar opcionais', async () => {
    assert.equal((await amb.pedir('/aluno/dashboard', { como: fabio })).local, '/aluno/completar-cadastro');
    assert.equal((await amb.pedir('/aluno/completar-cadastro', { como: fabio })).status, 200);

    for (const corpo of [
        { nome: 'Fábio Fontes', curso: 'Curso inexistente' },
        { nome: '', curso: CURSO },
        { nome: 'Fábio Fontes', curso: CURSO, avatarEmoji: '💣' },
        { nome: 'Fábio Fontes', curso: CURSO, matricula: 'x'.repeat(31) },
    ]) {
        const r = await amb.pedir('/aluno/completar-cadastro', { como: fabio, corpo });
        assert.equal(r.local, '/aluno/completar-cadastro', JSON.stringify(corpo));
        assert.equal(amb.flash(fabio).type, 'error');
    }

    // matrícula só com números
    await amb.pedir('/aluno/completar-cadastro', { como: fabio, corpo: { nome: 'Fábio Fontes', curso: CURSO, matricula: '2025-008076' } });
    assert.match(amb.flash(fabio).message, /apenas números/);

    // matrícula de outro estudante
    await amb.pedir('/aluno/completar-cadastro', { como: fabio, corpo: { nome: 'Fábio Fontes', curso: CURSO, matricula: '2024001' } });
    assert.match(amb.flash(fabio).message, /matrícula já está cadastrada/);

    const ok = await amb.pedir('/aluno/completar-cadastro', { como: fabio, corpo: { nome: '  Fábio F. Fontes ', curso: CURSO, matricula: '  ' } });
    assert.equal(ok.local, '/aluno/dashboard');
    const [aluno] = await amb.sql('SELECT a.status, a.matricula, a.curso, u.nome, u.avatar_emoji FROM alunos a JOIN usuarios u ON u.id = a.usuario_id WHERE usuario_id = $1', [fabio]);
    assert.deepEqual(aluno, { status: 'lista_espera', matricula: null, curso: CURSO, nome: 'Fábio F. Fontes', avatar_emoji: null });

    // espaços digitados no meio são ignorados
    await amb.sql('DELETE FROM alunos WHERE usuario_id = $1', [fabio]);
    await amb.pedir('/aluno/completar-cadastro', { como: fabio, corpo: { nome: 'Fábio Fontes', curso: CURSO, matricula: ' 2025 008 076 ' } });
    assert.equal((await amb.sql('SELECT matricula FROM alunos WHERE usuario_id = $1', [fabio]))[0].matricula, '2025008076');

    // quem já completou não preenche de novo
    assert.equal((await amb.pedir('/aluno/completar-cadastro', { como: fabio })).local, '/aluno/dashboard');
});

// ── Atividades ────────────────────────────────────────────────────────────
const atividade = (extra = {}) => ({ data: '2026-11-10', hora_inicio: '08:00', hora_fim: '12:00', descricao: 'Coleta de amostras', ...extra });

test('nova atividade: grava as horas calculadas e pré-seleciona o dia vindo do calendário', async () => {
    const tela = await amb.pedir('/aluno/nova-atividade?data=2026-11-09', { como: ana });
    assert.match(await tela.text(), /value="2026-11-09"/);

    const r = await amb.pedir('/aluno/nova-atividade', { como: ana, corpo: atividade({ hora_fim: '10:30' }) });
    assert.equal(r.local, '/aluno/atividades');
    assert.equal(amb.flash(ana).type, 'success');
    const [salva] = await amb.sql('SELECT horas, status_validacao, descricao FROM atividades WHERE aluno_id = $1', [ana]);
    assert.deepEqual({ ...salva, horas: Number(salva.horas) }, { horas: 2.5, status_validacao: 'pendente', descricao: 'Coleta de amostras' });
});

test('nova atividade: recusa dados inválidos e devolve o que foi digitado', async () => {
    const casos = [
        [atividade({ descricao: '   ' }), /Preencha todos os campos/],
        [atividade({ descricao: 'x'.repeat(141) }), /no máximo 140 caracteres/],
        [atividade({ hora_inicio: '12:00', hora_fim: '08:00' }), /posterior ao horário inicial/],
        [atividade({ hora_inicio: '25:00' }), /posterior ao horário inicial/],
        [atividade({ hora_inicio: '06:00', hora_fim: '12:30' }), /no máximo 6 horas/],
        [atividade({ data: '2026-02-30' }), /data válida/],
        [atividade({ data: '2026-11-15' }), /domingos/],
    ];
    for (const [corpo, mensagem] of casos) {
        const r = await amb.pedir('/aluno/nova-atividade', { como: ana, corpo });
        assert.equal(r.local, '/aluno/nova-atividade');
        assert.match(amb.flash(ana).message, mensagem);
    }
    // o formulário volta preenchido uma única vez
    await amb.pedir('/aluno/nova-atividade', { como: ana, corpo: atividade({ descricao: 'Texto que volta', data: '2026-11-15' }) });
    assert.match(await (await amb.pedir('/aluno/nova-atividade', { como: ana })).text(), /Texto que volta/);
    assert.doesNotMatch(await (await amb.pedir('/aluno/nova-atividade', { como: ana })).text(), /Texto que volta/);
    assert.equal((await amb.sql('SELECT COUNT(*)::int AS n FROM atividades WHERE aluno_id = $1', [ana]))[0].n, 0);
});

test('limite de 6 horas por dia soma as atividades já registradas', async () => {
    await amb.pedir('/aluno/nova-atividade', { como: ana, corpo: atividade() });
    amb.flash(ana);
    await amb.pedir('/aluno/nova-atividade', { como: ana, corpo: atividade({ hora_inicio: '13:00', hora_fim: '16:00' }) });
    assert.match(amb.flash(ana).message, /já registrou 4h nesta data; restam 2h/);
    await amb.pedir('/aluno/nova-atividade', { como: ana, corpo: atividade({ hora_inicio: '13:00', hora_fim: '15:00' }) });
    assert.equal(amb.flash(ana).type, 'success');
    await amb.pedir('/aluno/nova-atividade', { como: ana, corpo: atividade({ hora_inicio: '16:00', hora_fim: '16:30' }) });
    assert.match(amb.flash(ana).message, /já registrou o máximo de 6h/);
});

test('editar atividade validada volta para pendente; excluir remove do total', async () => {
    const criada = await atividades.criar({ alunoId: ana, data: '2026-11-10', horaInicio: '08:00', horaFim: '10:00', horas: 2, descricao: 'Antes' });
    await amb.sql("UPDATE atividades SET status_validacao = 'validada', avaliado_por = 13 WHERE id = $1", [criada.id]);

    const tela = await amb.pedir(`/aluno/atividade/${criada.id}/editar`, { como: ana });
    assert.match(await tela.text(), /Antes/);

    const r = await amb.pedir(`/aluno/atividade/${criada.id}/editar`, { como: ana, corpo: atividade({ descricao: 'Depois' }) });
    assert.equal(r.local, '/aluno/dashboard?aba=atividades');
    assert.match(amb.flash(ana).message, /enviada novamente para avaliação/);
    const [editada] = await amb.sql('SELECT descricao, status_validacao, avaliado_por FROM atividades WHERE id = $1', [criada.id]);
    assert.deepEqual(editada, { descricao: 'Depois', status_validacao: 'pendente', avaliado_por: null });

    // erro de validação volta para a edição com o texto digitado
    await amb.pedir(`/aluno/atividade/${criada.id}/editar`, { como: ana, corpo: atividade({ descricao: 'Errada', hora_fim: '07:00' }) });
    assert.match(amb.flash(ana).message, /posterior/);
    assert.match(await (await amb.pedir(`/aluno/atividade/${criada.id}/editar`, { como: ana })).text(), /Errada/);

    assert.equal((await amb.pedir(`/aluno/atividade/${criada.id}/excluir`, { como: ana, corpo: {} })).local, '/aluno/dashboard?aba=atividades');
    assert.match(amb.flash(ana).message, /Atividade excluída/);
    assert.equal((await amb.sql('SELECT COUNT(*)::int AS n FROM atividades WHERE id = $1', [criada.id]))[0].n, 0);
});

test('estudante não edita atividade de outra pessoa nem usa identificador inválido', async () => {
    const [deBruno] = await amb.sql('SELECT id FROM atividades WHERE aluno_id = $1', [bruno]);
    await amb.pedir(`/aluno/atividade/${deBruno.id}/editar`, { como: ana });
    assert.match(amb.flash(ana).message, /não encontrada/);
    await amb.pedir(`/aluno/atividade/${deBruno.id}/excluir`, { como: ana, corpo: {} });
    assert.match(amb.flash(ana).message, /não encontrada/);
    await amb.pedir('/aluno/atividade/abc/editar', { como: ana });
    assert.match(amb.flash(ana).message, /Atividade inválida/);
    assert.equal((await amb.sql('SELECT COUNT(*)::int AS n FROM atividades WHERE id = $1', [deBruno.id]))[0].n, 1);
});

test('estágio arquivado, concluído ou encerrado não recebe atividades', async () => {
    for (const quem of [eva, bruno, davi]) {
        const r = await amb.pedir('/aluno/nova-atividade', { como: quem, corpo: atividade() });
        assert.equal(r.local, '/aluno/dashboard');
        assert.match(amb.flash(quem).message, /enquanto o estágio estiver em andamento/);
    }
    assert.equal((await amb.sql('SELECT COUNT(*)::int AS n FROM atividades WHERE descricao = $1', ['Coleta de amostras']))[0].n, 0);
});

// ── Modelo de atividades: regras dentro da transação ─────────────────────
test('modelo de atividades bloqueia alteração fora do andamento e acima do limite diário', async () => {
    const a = await atividades.criar({ alunoId: ana, data: '2026-11-10', horaInicio: '08:00', horaFim: '12:00', horas: 4, descricao: 'A' });
    const b = await atividades.criar({ alunoId: ana, data: '2026-11-10', horaInicio: '13:00', horaFim: '15:00', horas: 2, descricao: 'B' });
    const editar = (extra) => atividades.atualizar({ atividadeId: b.id, alunoId: ana, data: '2026-11-10', horaInicio: '13:00', horaFim: '16:00', horas: 3, descricao: 'B', ...extra });

    assert.equal((await editar()).motivo, 'limite_diario');
    assert.equal((await editar({ atividadeId: 999999 })).motivo, 'nao_encontrada');
    assert.equal((await atividades.excluir({ atividadeId: 999999, alunoId: ana })).motivo, 'nao_encontrada');
    assert.equal((await atividades.ultimaPorAluno(ana)).id, b.id);
    assert.equal(await atividades.somarHorasDoDia(ana, '2026-11-10', a.id), 2);

    await amb.sql('UPDATE alunos SET arquivado = true WHERE usuario_id = $1', [ana]);
    assert.equal((await editar({ horas: 1 })).motivo, 'estagio_bloqueado');
    assert.equal((await atividades.excluir({ atividadeId: a.id, alunoId: ana })).motivo, 'estagio_bloqueado');
    assert.equal((await atividades.excluir({ atividadeId: a.id, alunoId: 999 })).motivo, 'estagio_bloqueado');
});

test('validar conclui o estágio ao atingir a carga; invalidar devolve para em andamento', async () => {
    await amb.sql('UPDATE alunos SET carga_horaria = 4 WHERE usuario_id = $1', [ana]);
    const a = await atividades.criar({ alunoId: ana, data: '2026-11-10', horaInicio: '08:00', horaFim: '12:00', horas: 4, descricao: 'A' });
    await assert.rejects(atividades.definirValidacao({ atividadeId: a.id, alunoId: ana, status: 'aprovada', validadorId: 13 }), /inválido/);
    assert.equal(await atividades.definirValidacao({ atividadeId: 999999, alunoId: ana, status: 'validada', validadorId: 13 }), null);

    assert.equal((await atividades.definirValidacao({ atividadeId: a.id, alunoId: ana, status: 'validada', validadorId: 13 })).status, 'concluido');
    const pendente = await atividades.definirValidacao({ atividadeId: a.id, alunoId: ana, status: 'pendente', validadorId: 13 });
    assert.equal(pendente.status, 'em_andamento');
    assert.equal(pendente.atividade.avaliado_por, null);
});

// ── FAA (autoavaliação) ───────────────────────────────────────────────────
const faa = (extra = {}) => ({
    periodo: '05/10/2026 a 05/10/2026', atividades: 'Manejo do pomar e colheita.', comentarios: 'Ótimo estágio',
    data_assinatura: '2026-11-12',
    ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`nota_${i + 1}`, '9'])),
    ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`q_${i + 1}`, ['sim', 'nao', 'mais_menos'][i % 3]])),
    ...extra,
});

test('FAA só abre depois de cumprir as horas e sugere o período das atividades validadas', async () => {
    const cedo = await amb.pedir('/aluno/faa', { como: ana });
    assert.equal(cedo.local, '/aluno/dashboard');
    assert.match(amb.flash(ana).message, /após a conclusão do estágio/);

    const tela = await amb.pedir('/aluno/faa', { como: bruno });
    assert.equal(tela.status, 200);
    assert.match(await tela.text(), /05\/10\/2026 a 05\/10\/2026/);
});

test('FAA: rascunho guarda o que foi digitado; salvar valida as notas e respostas', async () => {
    await amb.pedir('/aluno/faa', { como: bruno, corpo: { acao: 'rascunho', periodo: 'Rascunho do período', nota_1: '7' } });
    assert.match(amb.flash(bruno).message, /Rascunho da FAA salvo/);
    assert.match(await (await amb.pedir('/aluno/faa', { como: bruno })).text(), /Rascunho do período/);

    for (const extra of [{ nota_3: '11' }, { nota_4: '' }, { q_2: 'talvez' }, { data_assinatura: '2026-13-01' }, { periodo: '' }]) {
        await amb.pedir('/aluno/faa', { como: bruno, corpo: faa({ acao: 'salvar', ...extra }) });
        assert.match(amb.flash(bruno).message, /notas entre 0 e 10/, JSON.stringify(extra));
    }

    await amb.pedir('/aluno/faa', { como: bruno, corpo: faa({ acao: 'salvar' }) });
    assert.match(amb.flash(bruno).message, /Ficha salva/);
    const [salva] = await amb.sql('SELECT empresa, notas, respostas FROM faas WHERE aluno_id = $1', [bruno]);
    assert.equal(salva.empresa, 'Agro Vale');
    assert.deepEqual(salva.notas, Array(10).fill(9));
    assert.equal(salva.respostas.length, 7);
});

test('FAA: gera o PDF ao salvar e depois pela ficha salva', async () => {
    const semFicha = await amb.pedir('/aluno/faa/pdf', { como: bruno });
    assert.equal(semFicha.local, '/aluno/faa');

    const r = await amb.pedir('/aluno/faa', { como: bruno, corpo: faa() });
    assert.equal(nomeDoArquivo(r), 'FAA-Bruno-Brito.pdf');
    assert.equal((await pdf(r)).getPageCount(), 2);

    const depois = await amb.pedir('/aluno/faa/pdf', { como: bruno });
    assert.equal(nomeDoArquivo(depois), 'FAA-Bruno-Brito.pdf');
    await pdf(depois);
});

test('FAA: sem empresa cadastrada ou com estágio encerrado não é salva', async () => {
    await amb.sql('UPDATE alunos SET empresa = NULL WHERE usuario_id = $1', [bruno]);
    await amb.pedir('/aluno/faa', { como: bruno, corpo: faa({ acao: 'salvar' }) });
    assert.match(amb.flash(bruno).message, /empresa\/concedente não foi cadastrada/);

    assert.equal((await amb.pedir('/aluno/faa', { como: davi })).status, 200);
    const r = await amb.pedir('/aluno/faa', { como: davi, corpo: faa({ acao: 'salvar' }) });
    assert.equal(r.local, '/aluno/dashboard?aba=fichas');
    assert.match(amb.flash(davi).message, /encerrado/);
    assert.equal((await amb.sql('SELECT COUNT(*)::int AS n FROM faas')).at(0).n, 0);
});

// ── PDFs das demais fichas ────────────────────────────────────────────────
test('FAPO: o estudante baixa o PDF depois que o orientador avalia', async () => {
    assert.equal((await amb.pedir('/aluno/fapo/pdf', { como: bruno })).local, '/aluno/dashboard');
    assert.match(amb.flash(bruno).message, /ainda não foi avaliada/);

    await faposModel.salvar({ alunoId: bruno, nota: 8.5, comentarios: 'Dedicado', dataAssinatura: '2026-11-12' });
    const r = await amb.pedir('/aluno/fapo/pdf', { como: bruno });
    assert.equal(nomeDoArquivo(r), 'FAPO-Bruno-Brito.pdf');
    await pdf(r);
});

test('FAC: o estudante baixa a avaliação feita pelo supervisor', async () => {
    assert.equal((await amb.pedir('/aluno/fac/pdf', { como: bruno })).local, '/aluno/dashboard?aba=fichas');
    const salvou = await facsModel.salvar(bruno, { id: PESSOAS.externo, nome: 'Elisa Externa' }, {
        empresa: 'Agro Vale', curso: CURSO, periodo: '05/10/2026 a 05/10/2026', notas: Array(10).fill(8),
        atividades: 'Pomar', comentarios: '', local_assinatura: 'Videira', data_assinatura: '2026-11-12',
    });
    assert.equal(salvou, true);
    const r = await amb.pedir('/aluno/fac/pdf', { como: bruno });
    assert.equal(nomeDoArquivo(r), 'FAC-Bruno-Brito.pdf');
    assert.equal(r.headers.get('cache-control'), 'no-store, private');
    await pdf(r);
});

test('ata da banca: só depois do encerramento e com a ata salva', async () => {
    await amb.pedir('/aluno/fare/pdf', { como: bruno });
    assert.match(amb.flash(bruno).message, /depois que o orientador conclui/);

    await amb.pedir('/aluno/fare/pdf', { como: davi });
    assert.match(amb.flash(davi).message, /Não foi possível gerar o PDF da ata/);

    await faresModel.salvar({ alunoId: davi, periodo: '06/10/2026 a 06/10/2026', notaFac: 8, notaFaaManual: 9,
        banca: [[8, 8, 8], [9, 9, 9], [7, 7, 7]], avaliador1: 'Otto Outro', avaliador2: 'Saulo Supervisor',
        resultado: 'aprovado', comentarios: 'Parabéns', dataAta: '2026-11-12' });
    const r = await amb.pedir('/aluno/fare/pdf', { como: davi });
    assert.equal(nomeDoArquivo(r), 'Ata-Banca-Davi-Dias.pdf');
    await pdf(r);
});

test('ficha de acompanhamento lista só as atividades validadas', async () => {
    await atividades.criar({ alunoId: ana, data: '2026-11-10', horaInicio: '08:00', horaFim: '10:00', horas: 2, descricao: 'Validada' });
    await atividades.criar({ alunoId: ana, data: '2026-11-11', horaInicio: '08:00', horaFim: '09:30', horas: 1.5, descricao: 'Pendente' });
    await amb.sql("UPDATE atividades SET status_validacao = 'validada' WHERE descricao = 'Validada'");

    const r = await amb.pedir('/aluno/ficha-acompanhamento', { como: ana });
    assert.equal(nomeDoArquivo(r), 'Ficha-Acompanhamento-Ana-Andrade.pdf');
    const form = (await pdf(r)).getForm();
    assert.equal(form.getTextField('nome_estagiario').getText(), 'Ana Andrade');
    assert.equal(form.getTextField('atividade_01').getText(), 'Validada');
    assert.equal(form.getTextField('atividade_02').getText() || '', '');
    assert.equal(form.getTextField('total_horas_estagio').getText(), '2,00');
    assert.equal(form.getTextField('data_ultimo_dia').getText(), '10/11/2026');
});
