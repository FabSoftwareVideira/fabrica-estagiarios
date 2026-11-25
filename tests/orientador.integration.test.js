// Área do professor: FAPO, ata da banca (FARE), validação de horas,
// fichas para impressão e as restrições do supervisor externo.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { criarAmbiente, PESSOAS } = require('./helpers/ambiente');
const atividades = require('../src/models/atividades');
const faposModel = require('../src/models/fapos');
const faasModel = require('../src/models/faas');
const faresModel = require('../src/models/fares');

let amb;
const { admin, servidora, orientadora, supervisor, externo, externoPendente, outroProfessor, semNome, ana, bruno, carla, davi, eva } = PESSOAS;

before(async () => { amb = await criarAmbiente(); });
beforeEach(async () => { await amb.semear(); });
after(async () => { await amb.fechar(); });

const nomeDoArquivo = (r) => /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1];
async function pdf(r) {
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    return PDFDocument.load(Buffer.from(await r.arrayBuffer()));
}

// ── Entrada na área do professor ─────────────────────────────────────────
test('identificador inválido na URL é página inexistente, não erro do banco', async () => {
    for (const rota of ['/professor/aluno/abc', '/professor/aluno/0', '/professor/aluno/99999999999', '/professor/aluno/201/atividade/x/validar']) {
        assert.equal((await amb.pedir(rota, { como: orientadora })).status, 404, rota);
    }
});

test('estudante não entra na área do professor; professor sem nome confirmado completa o cadastro', async () => {
    assert.equal((await amb.pedir('/professor/dashboard', { como: ana })).local, '/aluno/dashboard');
    assert.equal((await amb.pedir('/professor/dashboard', { como: semNome })).local, '/professor/completar-cadastro');
    assert.equal((await amb.pedir('/professor/completar-cadastro', { como: semNome })).status, 200);

    await amb.pedir('/professor/completar-cadastro', { como: semNome, corpo: { nome: '  ' } });
    assert.equal(amb.flash(semNome).type, 'error');
    await amb.pedir('/professor/completar-cadastro', { como: semNome, corpo: { nome: 'Paula Professora', avatarEmoji: '🦊' } });
    assert.equal(amb.flash(semNome).type, 'success');
    const [u] = await amb.sql('SELECT nome, nome_confirmado, avatar_emoji FROM usuarios WHERE id = $1', [semNome]);
    assert.deepEqual(u, { nome: 'Paula Professora', nome_confirmado: true, avatar_emoji: '🦊' });
    assert.equal((await amb.pedir('/professor/completar-cadastro', { como: semNome })).local, '/professor/dashboard');
});

test('a tela inicial depende dos papéis', async () => {
    assert.equal((await amb.pedir('/professor/inicio', { como: servidora })).local, '/professor/acompanhamento');
    assert.equal((await amb.pedir('/professor/inicio', { como: orientadora })).local, '/professor/dashboard');
    assert.equal((await amb.pedir('/professor/inicio', { como: admin })).local, '/professor/administracao');
    assert.equal((await amb.pedir('/professor/inicio', { como: externo })).local, '/professor/dashboard');
});

// ── Supervisor externo ───────────────────────────────────────────────────
test('supervisor externo pendente espera a aprovação', async () => {
    assert.equal((await amb.pedir('/professor/dashboard', { como: externoPendente })).local, '/supervisor/pendente');
    const espera = await amb.pedir('/supervisor/pendente', { como: externoPendente });
    assert.equal(espera.status, 200);
    assert.match(await espera.text(), /Cooper Sul/);

    await amb.sql('UPDATE professores SET aprovado = true WHERE usuario_id = $1', [externoPendente]);
    assert.equal((await amb.pedir('/supervisor/pendente', { como: externoPendente })).local, '/professor/dashboard');
    // quem não é supervisor externo não tem essa tela
    assert.equal((await amb.pedir('/supervisor/pendente', { como: orientadora })).local, '/professor/dashboard');
    assert.equal((await amb.pedir('/supervisor/pendente', { como: ana })).local, '/aluno/dashboard');
    assert.equal((await amb.pedir('/supervisor/pendente')).local, '/login');
});

test('supervisor externo só vê os próprios supervisionados e só o que lhe cabe', async () => {
    assert.equal((await amb.pedir(`/professor/aluno/${bruno}`, { como: externo })).status, 200);
    assert.equal((await amb.pedir(`/professor/aluno/${ana}`, { como: externo })).status, 403);
    // FAPO, ata e telas de gestão ficam fora
    for (const rota of [`/professor/aluno/${bruno}/fapo`, `/professor/aluno/${bruno}/fare`, '/professor/fichas', '/professor/usuarios', '/professor/acompanhamento']) {
        assert.equal((await amb.pedir(rota, { como: externo })).local, '/professor/dashboard', rota);
    }
    await pdf(await amb.pedir(`/professor/aluno/${bruno}/ficha-acompanhamento`, { como: externo }));
});

// ── Validação de horas ───────────────────────────────────────────────────
test('só o supervisor do estagiário valida; a validação final conclui o estágio', async () => {
    await amb.sql('UPDATE alunos SET carga_horaria = 2 WHERE usuario_id = $1', [ana]);
    const a = await atividades.criar({ alunoId: ana, data: '2026-11-10', horaInicio: '08:00', horaFim: '10:00', horas: 2, descricao: 'Ensaio' });
    const validar = (quem, id = a.id, acao = 'validar') => amb.pedir(`/professor/aluno/${ana}/atividade/${id}/${acao}`, { como: quem, corpo: {} });

    await validar(orientadora);
    assert.match(amb.flash(orientadora).message, /Somente o supervisor/);
    await validar(supervisor, 999999);
    assert.match(amb.flash(supervisor).message, /não encontrada/);

    assert.equal((await validar(supervisor)).local, `/professor/aluno/${ana}`);
    assert.match(amb.flash(supervisor).message, /completou a carga horária/);
    assert.equal((await amb.sql('SELECT status FROM alunos WHERE usuario_id = $1', [ana]))[0].status, 'concluido');

    await validar(supervisor, a.id, 'invalidar');
    assert.match(amb.flash(supervisor).message, /voltou para "Em andamento"/);
    await validar(supervisor, a.id, 'invalidar');
    assert.match(amb.flash(supervisor).message, /não contam mais/);
    await validar(supervisor);
    await validar(supervisor);
    assert.equal(amb.flash(supervisor).message, 'Atividade validada com sucesso.');
});

test('desligamento preserva histórico e aproveita só horas validadas após solicitação e confirmação', async () => {
    await amb.sql(`INSERT INTO atividades (aluno_id, data, hora_inicio, hora_fim, horas, descricao, status_validacao, avaliado_por)
        VALUES ($1, '2026-10-05', '08:00', '12:00', 4, 'Atividade anterior', 'validada', $2),
               ($1, '2026-10-06', '08:00', '10:00', 2, 'Pendente anterior', 'pendente', NULL)`, [ana, supervisor]);
    await amb.pedir(`/professor/aluno/${ana}/desligar`, { como: orientadora, corpo: {} });
    assert.match(amb.flash(orientadora).message, /Somente o supervisor/);
    await amb.pedir(`/professor/aluno/${ana}/desligar`, { como: supervisor, corpo: {} });
    assert.match(amb.flash(supervisor).message, /Comunique o estudante/);
    const [d] = await amb.sql('SELECT * FROM desligamentos WHERE aluno_id = $1', [ana]);
    assert.equal(d.empresa, 'Agro Vale');
    let [aluno] = await amb.sql('SELECT status, supervisor_id FROM alunos WHERE usuario_id = $1', [ana]);
    assert.deepEqual(aluno, { status: 'lista_espera', supervisor_id: null });
    assert.equal((await amb.sql('SELECT COUNT(*)::int AS n FROM atividades WHERE aluno_id = $1 AND contabilizar', [ana]))[0].n, 0);

    const ficha = await pdf(await amb.pedir(`/aluno/desligamentos/${d.id}/ficha-acompanhamento`, { como: ana }));
    assert.equal(ficha.getForm().getTextField('empresa').getText(), 'Agro Vale');
    assert.equal(ficha.getForm().getTextField('atividade_01').getText(), 'Atividade anterior');
    assert.equal(ficha.getForm().getTextField('total_horas_estagio').getText(), '4,00');
    assert.equal((await amb.pedir(`/aluno/desligamentos/${d.id}/ficha-acompanhamento`, { como: bruno })).status, 404);

    const cadastro = { empresa: 'Agro Vale', carga_horaria: '5', supervisor_id: String(outroProfessor), orientador_id: String(orientadora), versao_estagio: '1' };
    await amb.pedir(`/professor/cadastro-aluno/${ana}`, { como: outroProfessor, corpo: cadastro });
    assert.match(amb.flash(outroProfessor).message, /Apenas o orientador ou a gestão/);
    await amb.pedir(`/professor/cadastro-aluno/${ana}`, { como: orientadora, corpo: cadastro });
    assert.match(amb.flash(orientadora).message, /local é igual ao anterior/);
    await amb.pedir(`/professor/cadastro-aluno/${ana}`, { como: orientadora, corpo: { ...cadastro, empresa: 'Outra Empresa' } });
    assert.equal(amb.flash(orientadora).type, 'success');
    await amb.pedir('/aluno/nova-atividade', { como: ana, corpo: {
        versao_estagio: '0', data: '2026-11-10', hora_inicio: '08:00', hora_fim: '09:00', descricao: 'Formulário antigo',
    } });
    assert.match(amb.flash(ana).message, /estágio foi alterado/);
    assert.equal((await amb.sql("SELECT COUNT(*)::int AS n FROM atividades WHERE descricao = 'Formulário antigo'"))[0].n, 0);

    const [anterior] = await amb.sql("SELECT id FROM atividades WHERE aluno_id = $1 AND descricao = 'Atividade anterior'", [ana]);
    await amb.pedir(`/professor/aluno/${ana}/atividade/${anterior.id}/invalidar`, { como: outroProfessor, corpo: {} });
    assert.match(amb.flash(outroProfessor).message, /não encontrada/);
    assert.equal((await amb.pedir(`/aluno/atividade/${anterior.id}/editar`, { como: ana })).local, '/aluno/dashboard?aba=atividades');
    await amb.pedir(`/professor/aluno/${ana}/desligamentos/${d.id}/confirmar`, { como: orientadora, corpo: { ficha_assinada: 'sim' } });
    assert.match(amb.flash(orientadora).message, /não foi solicitado/);
    await amb.pedir(`/aluno/desligamentos/${d.id}/aproveitar`, { como: ana, corpo: {} });
    assert.equal(amb.flash(ana).type, 'success');
    await amb.pedir(`/professor/aluno/${ana}/desligamentos/${d.id}/confirmar`, { como: outroProfessor, corpo: { ficha_assinada: 'sim' } });
    assert.match(amb.flash(outroProfessor).message, /Somente o orientador ou a gestão/);
    await amb.pedir(`/professor/aluno/${ana}/desligamentos/${d.id}/confirmar`, { como: orientadora, corpo: {} });
    assert.match(amb.flash(orientadora).message, /Confirme o recebimento/);
    await amb.pedir(`/professor/aluno/${ana}/desligamentos/${d.id}/confirmar`, { como: orientadora, corpo: { ficha_assinada: 'sim' } });
    assert.equal(amb.flash(orientadora).type, 'success');
    const contadas = await amb.sql('SELECT descricao, contabilizar FROM atividades WHERE aluno_id = $1 ORDER BY data', [ana]);
    assert.deepEqual(contadas, [
        { descricao: 'Atividade anterior', contabilizar: true },
        { descricao: 'Pendente anterior', contabilizar: false },
    ]);
    const nova = await atividades.criar({ alunoId: ana, data: '2026-11-10', horaInicio: '08:00', horaFim: '09:00', horas: 1, descricao: 'Novo local' });
    await amb.pedir(`/professor/aluno/${ana}/atividade/${nova.id}/validar`, { como: outroProfessor, corpo: {} });
    [aluno] = await amb.sql('SELECT status FROM alunos WHERE usuario_id = $1', [ana]);
    assert.equal(aluno.status, 'concluido');
    await assert.rejects(faasModel.salvar({ alunoId: ana, empresa: 'Agro Vale', periodo: 'x',
        notas: Array(10).fill(6), atividades: 'x', respostas: Array(7).fill('sim'),
        comentarios: '', dataAssinatura: '2026-11-12', contexto: { versao: 0 } }), /estágio foi alterado/);
    await amb.pedir('/aluno/faa', { como: ana, corpo: { acao: 'rascunho', versao_estagio: '0' } });
    assert.match(amb.flash(ana).message, /estágio foi alterado/);
    assert.equal((await amb.sql("SELECT COUNT(*)::int AS n FROM fichas_rascunhos WHERE aluno_id = $1 AND tipo = 'FAA'", [ana]))[0].n, 0);
    await amb.pedir('/aluno/faa', { como: ana, corpo: { acao: 'rascunho', versao_estagio: '1' } });
    assert.equal(amb.flash(ana).type, 'success');
    assert.match(await (await amb.pedir('/aluno/dashboard?aba=fichas', { como: ana })).text(), /Horas aproveitadas/);
    await amb.pedir(`/professor/aluno/${ana}/desligamentos/${d.id}/confirmar`, { como: orientadora, corpo: { ficha_assinada: 'sim' } });
    assert.match(amb.flash(orientadora).message, /já foi confirmado/);
});

test('supervisor externo desliga sem fichas e sem pedido de aproveitamento', async () => {
    await amb.pedir(`/professor/aluno/${bruno}/desligar`, { como: externo, corpo: {} });
    assert.equal(amb.flash(externo).type, 'success');
    const [d] = await amb.sql('SELECT * FROM desligamentos WHERE aluno_id = $1', [bruno]);
    assert.ok(d);
    assert.equal(d.solicitado_em, null);
    assert.equal((await amb.sql('SELECT status FROM alunos WHERE usuario_id = $1', [bruno]))[0].status, 'lista_espera');
    assert.equal((await amb.pedir(`/professor/aluno/${bruno}`, { como: externo })).status, 403);
});

test('supervisor reverte desligamento e restaura estágio e fichas sem reabrir banca', async () => {
    const horario = { 1: { inicio: '08:00', fim: '12:00' } };
    await amb.sql('UPDATE alunos SET horario_trabalho = $2::jsonb WHERE usuario_id = $1', [bruno, JSON.stringify(horario)]);
    await amb.sql(`INSERT INTO atividades (aluno_id, data, horas, descricao, status_validacao)
        VALUES ($1, '2026-10-06', 1, 'Pendente', 'pendente')`, [bruno]);
    await faasModel.salvar({ alunoId: bruno, empresa: 'Agro Vale', periodo: 'x', notas: Array(10).fill(6), atividades: 'x',
        respostas: Array(7).fill('sim'), comentarios: 'Antes', dataAssinatura: '2026-11-12' });
    await faposModel.salvar({ alunoId: bruno, nota: 8, comentarios: 'FAPO', dataAssinatura: '2026-11-12' });
    await amb.sql(`INSERT INTO facs (aluno_id, supervisor_id, supervisor_nome, empresa, curso, periodo, notas,
        atividades, comentarios, local_assinatura, data_assinatura)
        SELECT usuario_id, $2, 'Elisa Externa', empresa, curso, 'Período',
            '[8,8,8,8,8,8,8,8,8,8]'::jsonb, 'Atividades', 'FAC anterior', 'Videira', '2026-11-12'
        FROM alunos WHERE usuario_id = $1`, [bruno, externo]);
    await amb.sql("INSERT INTO fares (aluno_id, periodo, comentarios) VALUES ($1, 'Período', 'Ata anterior')", [bruno]);
    await amb.sql(`INSERT INTO fichas_rascunhos (aluno_id, tipo, dados) VALUES ($1, 'FAC', '{"comentarios":"Rascunho"}')`, [bruno]);
    await amb.sql(`INSERT INTO bancas (aluno_id, orientador_id, avaliador_1_id, avaliador_2_id, data, hora_inicio, hora_fim, sala, situacao)
        VALUES ($1, $2, $3, $4, '2026-12-10', '08:00', '09:00', 'Sala', 'agendada')`,
    [bruno, orientadora, supervisor, outroProfessor]);
    await amb.pedir(`/professor/aluno/${bruno}/desligar`, { como: externo, corpo: {} });
    const [d] = await amb.sql('SELECT id FROM desligamentos WHERE aluno_id = $1', [bruno]);
    const botao = `/professor/desligamentos/${d.id}/reverter`;
    assert.match(await (await amb.pedir('/professor/dashboard', { como: externo })).text(), new RegExp(botao));
    const filtrar = async (situacao) => (await amb.pedir(`/professor/dashboard?f=1&situacao=${situacao}`, { como: externo })).text();
    assert.match(await filtrar('desligado'), new RegExp(botao));
    assert.doesNotMatch(await filtrar('andamento'), new RegExp(botao));
    assert.doesNotMatch(await (await amb.pedir('/professor/dashboard', { como: supervisor })).text(), new RegExp(botao));
    await amb.pedir(botao, { como: supervisor, corpo: {} });
    assert.match(amb.flash(supervisor).message, /não pode reverter/);

    await amb.pedir(`/aluno/desligamentos/${d.id}/aproveitar`, { como: bruno, corpo: {} });
    await amb.pedir(`/professor/aluno/${bruno}/desligamentos/${d.id}/confirmar`, { como: orientadora, corpo: { ficha_assinada: 'sim' } });
    assert.equal(amb.flash(orientadora).type, 'success');
    const resposta = await amb.pedir(botao, { como: externo, corpo: {} });
    assert.equal(resposta.local, `/professor/aluno/${bruno}`);
    assert.match(amb.flash(externo).message, /banca cancelada permanece cancelada/);
    const [aluno] = await amb.sql('SELECT status, empresa, supervisor_id, horario_trabalho, versao_estagio FROM alunos WHERE usuario_id = $1', [bruno]);
    assert.deepEqual(aluno, { status: 'concluido', empresa: 'Agro Vale', supervisor_id: externo, horario_trabalho: horario, versao_estagio: 2 });
    assert.equal((await faasModel.buscarPorAluno(bruno)).comentarios, 'Antes');
    assert.equal((await faposModel.buscarPorAluno(bruno)).comentarios, 'FAPO');
    assert.equal((await amb.sql('SELECT comentarios FROM facs WHERE aluno_id = $1', [bruno]))[0].comentarios, 'FAC anterior');
    assert.equal((await faresModel.buscarPorAluno(bruno)).comentarios, 'Ata anterior');
    assert.equal((await amb.sql("SELECT dados FROM fichas_rascunhos WHERE aluno_id = $1 AND tipo = 'FAC'", [bruno]))[0].dados.comentarios, 'Rascunho');
    const registros = await amb.sql('SELECT status_validacao, desligamento_id, contabilizar FROM atividades WHERE aluno_id = $1 ORDER BY data', [bruno]);
    assert.deepEqual(registros, [
        { status_validacao: 'validada', desligamento_id: null, contabilizar: true },
        { status_validacao: 'pendente', desligamento_id: null, contabilizar: true },
    ]);
    assert.equal((await amb.sql('SELECT situacao FROM bancas WHERE aluno_id = $1', [bruno]))[0].situacao, 'cancelada');
    assert.ok((await amb.sql('SELECT revertido_em FROM desligamentos WHERE id = $1', [d.id]))[0].revertido_em);
    assert.doesNotMatch(await (await amb.pedir('/professor/dashboard', { como: externo })).text(), new RegExp(botao));
    await amb.pedir(botao, { como: externo, corpo: {} });
    assert.match(amb.flash(externo).message, /não pode mais ser revertido/);
    assert.equal((await amb.pedir(`/aluno/desligamentos/${d.id}/ficha-acompanhamento`, { como: bruno })).status, 404);
});

test('desligamento não pode ser revertido depois do cadastro de novo estágio', async () => {
    await amb.pedir(`/professor/aluno/${ana}/desligar`, { como: supervisor, corpo: {} });
    const [d] = await amb.sql('SELECT id FROM desligamentos WHERE aluno_id = $1', [ana]);
    await amb.pedir(`/professor/cadastro-aluno/${ana}`, { como: orientadora, corpo: {
        versao_estagio: '1', empresa: 'Outro local', carga_horaria: '100',
        supervisor_id: String(outroProfessor), orientador_id: String(orientadora),
    } });
    assert.equal(amb.flash(orientadora).type, 'success');
    assert.doesNotMatch(await (await amb.pedir('/professor/dashboard', { como: supervisor })).text(), new RegExp(`/professor/desligamentos/${d.id}/reverter`));
    await amb.pedir(`/professor/desligamentos/${d.id}/reverter`, { como: supervisor, corpo: {} });
    assert.match(amb.flash(supervisor).message, /não pode mais ser revertido/);
    const [aluno] = await amb.sql('SELECT status, empresa, supervisor_id FROM alunos WHERE usuario_id = $1', [ana]);
    assert.deepEqual(aluno, { status: 'em_andamento', empresa: 'Outro local', supervisor_id: outroProfessor });
});

test('setor de estágios desliga e desfaz o desligamento em nome do supervisor', async () => {
    await amb.pedir(`/professor/aluno/${ana}/desligar`, { como: servidora, corpo: {} });
    assert.match(amb.flash(servidora).message, /Comunique o estudante/);
    const [d] = await amb.sql('SELECT id, supervisor_id, desligado_por FROM desligamentos WHERE aluno_id = $1', [ana]);
    assert.deepEqual({ supervisor_id: d.supervisor_id, desligado_por: d.desligado_por }, { supervisor_id: supervisor, desligado_por: servidora });
    const pagina = await (await amb.pedir(`/professor/aluno/${ana}`, { como: servidora })).text();
    assert.match(pagina, new RegExp(`/professor/desligamentos/${d.id}/reverter`));
    const acompanhamento = await (await amb.pedir('/professor/acompanhamento', { como: servidora })).text();
    assert.match(acompanhamento, new RegExp(`/professor/desligamentos/${d.id}/reverter`));
    await amb.pedir(`/professor/desligamentos/${d.id}/reverter`, { como: servidora, corpo: {} });
    assert.match(amb.flash(servidora).message, /Desligamento revertido/);
    const [aluno] = await amb.sql('SELECT supervisor_id, status FROM alunos WHERE usuario_id = $1', [ana]);
    assert.equal(aluno.supervisor_id, supervisor);
    assert.notEqual(aluno.status, 'lista_espera');
});

test('reversão de desligamento antigo avisa quando a escala não foi preservada', async () => {
    await amb.pedir(`/professor/aluno/${ana}/desligar`, { como: supervisor, corpo: {} });
    const [d] = await amb.sql('UPDATE desligamentos SET horario_trabalho_anterior = NULL WHERE aluno_id = $1 RETURNING id', [ana]);
    const painel = await (await amb.pedir('/professor/dashboard', { como: supervisor })).text();
    assert.match(painel, /escala deverá ser informada novamente/);
    assert.match(painel, /Desligado<\/span>/);
    await amb.pedir(`/professor/desligamentos/${d.id}/reverter`, { como: supervisor, corpo: {} });
    assert.match(amb.flash(supervisor).message, /escala anterior não foi salva/);
});

test('desligado aparece na lista como os demais, com a situação "Desligado" e o cancelamento para quem pode', async () => {
    await amb.pedir(`/professor/aluno/${ana}/desligar`, { como: supervisor, corpo: {} });
    const [d] = await amb.sql('SELECT id FROM desligamentos WHERE aluno_id = $1', [ana]);
    const botao = new RegExp(`/professor/desligamentos/${d.id}/reverter`);
    const linhaDaAna = (html) => /<tr>\s*<td>(?:(?!<\/tr>)[\s\S])*Ana Andrade(?:(?!<\/tr>)[\s\S])*<\/tr>/.exec(html)?.[0] || '';

    // quem desligou: mesma tabela, contada na paginação, sem link para a ficha que ele não vê mais
    const doSupervisor = await (await amb.pedir('/professor/dashboard', { como: supervisor })).text();
    assert.match(linhaDaAna(doSupervisor), /Desligado<\/span>/);
    assert.match(linhaDaAna(doSupervisor), botao);
    assert.match(linhaDaAna(doSupervisor), /Ex-supervisionado/);
    assert.doesNotMatch(linhaDaAna(doSupervisor), new RegExp(`href="/professor/aluno/${ana}"`));
    assert.doesNotMatch(doSupervisor, /supervisionados-grid/);
    assert.match(doSupervisor, /Mostrando 1–3 de 3 estagiário/);

    // orientador: vê a situação, mas o cancelamento é de quem desligou ou da gestão
    const doOrientador = await (await amb.pedir('/professor/dashboard', { como: orientadora })).text();
    assert.match(linhaDaAna(doOrientador), /Desligado<\/span>/);
    assert.match(linhaDaAna(doOrientador), /desligado por Saulo Supervisor/);
    assert.doesNotMatch(linhaDaAna(doOrientador), botao);
    assert.doesNotMatch(linhaDaAna(doOrientador), /title="Aprovar"/);

    // filtros: "Desligados" separa da lista de espera comum
    const filtrar = async (status) => (await amb.pedir(`/professor/dashboard?f=1&status=${status}`, { como: orientadora })).text();
    assert.match(await filtrar('desligado'), /Ana Andrade/);
    assert.doesNotMatch(await filtrar('lista_espera'), /Ana Andrade/);

    // ficha: aviso com o cancelamento como ação principal e o novo estágio como alternativa
    const fichaOrientador = await (await amb.pedir(`/professor/aluno/${ana}`, { como: orientadora })).text();
    assert.match(fichaOrientador, /Desligado em/);
    assert.match(fichaOrientador, /O cancelamento é feito por quem registrou o desligamento/);
    assert.match(fichaOrientador, /Cadastrar estágio em outro local/);
    assert.doesNotMatch(fichaOrientador, /Registrar desligamento/);
    assert.match(await (await amb.pedir(`/professor/aluno/${ana}`, { como: servidora })).text(), botao);

    // acompanhamento: etapa própria, com pendência explicativa
    const acompanhamento = await (await amb.pedir('/professor/acompanhamento?etapa=desligado', { como: servidora })).text();
    assert.match(acompanhamento, /Desligado de Agro Vale em/);
    assert.doesNotMatch(acompanhamento, /Bruno Brito/);

    // estudante: sabe que o desligamento ainda pode ser cancelado
    const doEstudante = await (await amb.pedir('/aluno/dashboard', { como: ana })).text();
    assert.match(doEstudante, /Você foi desligado do estágio/);
    assert.match(doEstudante, /Desligado<\/span>/);

    // cancelado: volta a ser um supervisionado comum
    await amb.pedir(`/professor/desligamentos/${d.id}/reverter`, { como: supervisor, corpo: {} });
    const depois = await (await amb.pedir('/professor/dashboard', { como: supervisor })).text();
    assert.match(linhaDaAna(depois), /Supervisionado/);
    assert.doesNotMatch(linhaDaAna(depois), /Desligado<\/span>/);
});

test('registrar desligamento fica recolhido no fim da ficha', async () => {
    const ficha = await (await amb.pedir(`/professor/aluno/${ana}`, { como: supervisor })).text();
    assert.match(ficha, /<details class="card acao-rara">\s*<summary>O estudante deixou o estágio\? Registrar desligamento<\/summary>/);
    assert.ok(ficha.indexOf('acao-rara') > ficha.indexOf('student-dashboard-tabs'));
    assert.doesNotMatch(await (await amb.pedir(`/professor/aluno/${ana}`, { como: orientadora })).text(), /acao-rara/);
});

test('reversão não sobrescreve fichas criadas depois do desligamento', async () => {
    await amb.pedir(`/professor/aluno/${bruno}/desligar`, { como: externo, corpo: {} });
    const [d] = await amb.sql('SELECT id FROM desligamentos WHERE aluno_id = $1', [bruno]);
    await amb.sql("INSERT INTO fapos (aluno_id, nota, comentarios, data_assinatura) VALUES ($1, 7, 'Ficha atual', '2026-11-12')", [bruno]);
    await amb.pedir(`/professor/desligamentos/${d.id}/reverter`, { como: externo, corpo: {} });
    assert.match(amb.flash(externo).message, /fichas atuais/);
    assert.equal((await faposModel.buscarPorAluno(bruno)).comentarios, 'Ficha atual');
    assert.equal((await amb.sql('SELECT status FROM alunos WHERE usuario_id = $1', [bruno]))[0].status, 'lista_espera');
    assert.equal((await amb.sql('SELECT revertido_em FROM desligamentos WHERE id = $1', [d.id]))[0].revertido_em, null);
});

test('desligamentos sucessivos mantêm a decisão sobre cada estágio separadamente', async () => {
    await amb.sql(`INSERT INTO atividades (aluno_id, data, horas, descricao, status_validacao)
        VALUES ($1, '2026-10-05', 3, 'Primeiro local', 'validada')`, [ana]);
    await amb.pedir(`/professor/aluno/${ana}/desligar`, { como: supervisor, corpo: {} });
    const [primeiro] = await amb.sql('SELECT id FROM desligamentos WHERE aluno_id = $1', [ana]);
    await amb.pedir(`/professor/cadastro-aluno/${ana}`, { como: orientadora, corpo: {
        versao_estagio: '1', empresa: 'Segundo local', carga_horaria: '10',
        supervisor_id: String(outroProfessor), orientador_id: String(orientadora),
    } });
    assert.equal(amb.flash(orientadora).type, 'success');
    const atividade = await atividades.criar({ alunoId: ana, data: '2026-11-10', horaInicio: '08:00', horaFim: '10:00', horas: 2, descricao: 'Segundo local' });
    await amb.pedir(`/professor/aluno/${ana}/atividade/${atividade.id}/validar`, { como: outroProfessor, corpo: {} });
    await amb.pedir(`/professor/aluno/${ana}/desligar`, { como: outroProfessor, corpo: { versao_estagio: '1' } });
    assert.equal(amb.flash(outroProfessor).type, 'success');
    const historico = await amb.sql('SELECT id, empresa FROM desligamentos WHERE aluno_id = $1 ORDER BY id', [ana]);
    assert.deepEqual(historico.map((d) => d.empresa), ['Agro Vale', 'Segundo local']);
    await amb.pedir(`/aluno/desligamentos/${primeiro.id}/aproveitar`, { como: ana, corpo: {} });
    await amb.pedir(`/professor/aluno/${ana}/desligamentos/${primeiro.id}/confirmar`, { como: orientadora, corpo: { ficha_assinada: 'sim' } });
    assert.equal(amb.flash(orientadora).type, 'success');
    const registros = await amb.sql('SELECT descricao, contabilizar FROM atividades WHERE aluno_id = $1 ORDER BY data', [ana]);
    assert.deepEqual(registros, [
        { descricao: 'Primeiro local', contabilizar: true },
        { descricao: 'Segundo local', contabilizar: false },
    ]);
});

test('desligamento cancela banca agendada e preserva fichas já preenchidas', async () => {
    await faasModel.salvar({ alunoId: bruno, empresa: 'Agro Vale', periodo: 'x', notas: Array(10).fill(6), atividades: 'x',
        respostas: Array(7).fill('sim'), comentarios: '', dataAssinatura: '2026-11-12' });
    await amb.sql(`INSERT INTO bancas (aluno_id, orientador_id, avaliador_1_id, avaliador_2_id, data, hora_inicio, hora_fim, sala, situacao)
        VALUES ($1, $2, $3, $4, '2026-12-10', '08:00', '09:00', 'Sala', 'agendada')`,
    [bruno, orientadora, supervisor, outroProfessor]);
    await amb.pedir(`/professor/aluno/${bruno}/desligar`, { como: externo, corpo: {} });
    assert.match(amb.flash(externo).message, /banca agendada foi cancelada; avise os participantes/);
    const [d] = await amb.sql('SELECT fichas_anteriores FROM desligamentos WHERE aluno_id = $1', [bruno]);
    assert.equal(d.fichas_anteriores.faa.empresa, 'Agro Vale');
    assert.equal(await faasModel.buscarPorAluno(bruno), null);
    assert.equal((await amb.sql('SELECT situacao FROM bancas WHERE aluno_id = $1', [bruno]))[0].situacao, 'cancelada');
});

test('estágio com banca realizada não pode ser desligado', async () => {
    await amb.sql(`INSERT INTO bancas (aluno_id, orientador_id, avaliador_1_id, avaliador_2_id, data, hora_inicio, hora_fim, sala, situacao)
        VALUES ($1, $2, $3, $4, '2026-10-10', '08:00', '09:00', 'Sala', 'realizada')`,
    [bruno, orientadora, supervisor, outroProfessor]);
    await amb.pedir(`/professor/aluno/${bruno}/desligar`, { como: externo, corpo: {} });
    assert.match(amb.flash(externo).message, /banca já foi realizada/);
    assert.equal((await amb.sql('SELECT COUNT(*)::int AS n FROM desligamentos WHERE aluno_id = $1', [bruno]))[0].n, 0);
});

test('estágio arquivado ou encerrado não tem validações alteradas', async () => {
    const [deDavi] = await amb.sql('SELECT id FROM atividades WHERE aluno_id = $1', [davi]);
    await amb.pedir(`/professor/aluno/${davi}/atividade/${deDavi.id}/invalidar`, { como: supervisor, corpo: {} });
    assert.match(amb.flash(supervisor).message, /encerrado/);
    await amb.pedir(`/professor/aluno/${eva}/atividade/1/validar`, { como: supervisor, corpo: {} });
    assert.match(amb.flash(supervisor).message, /arquivado/);
    await amb.pedir('/professor/aluno/9999/atividade/1/validar', { como: supervisor, corpo: {} });
    assert.match(amb.flash(supervisor).message, /não encontrado/);
});

// ── FAPO ─────────────────────────────────────────────────────────────────
test('FAPO: exclusiva do orientador e só com as horas cumpridas', async () => {
    await amb.pedir(`/professor/aluno/${ana}/fapo`, { como: orientadora });
    assert.match(amb.flash(orientadora).message, /após a conclusão/);
    await amb.pedir(`/professor/aluno/${bruno}/fapo`, { como: outroProfessor });
    assert.match(amb.flash(outroProfessor).message, /Apenas o professor orientador/);
    await amb.pedir('/professor/aluno/9999/fapo', { como: orientadora });
    assert.match(amb.flash(orientadora).message, /não encontrado/);
    assert.equal((await amb.pedir(`/professor/aluno/${bruno}/fapo`, { como: orientadora })).status, 200);
});

test('FAPO: rascunho, validação, salvar e PDF', async () => {
    const rota = `/professor/aluno/${bruno}/fapo`;
    await amb.pedir(rota, { como: orientadora, corpo: { acao: 'rascunho', nota: '7', comentarios: 'Ainda pensando' } });
    assert.match(amb.flash(orientadora).message, /Rascunho da FAPO salvo/);
    assert.match(await (await amb.pedir(rota, { como: orientadora })).text(), /Ainda pensando/);

    for (const corpo of [{ nota: '', data_assinatura: '2026-11-12' }, { nota: '10.5', data_assinatura: '2026-11-12' }, { nota: '8', data_assinatura: 'ontem' }]) {
        await amb.pedir(rota, { como: orientadora, corpo: { acao: 'salvar', ...corpo } });
        assert.match(amb.flash(orientadora).message, /nota entre 0 e 10/);
    }
    assert.equal((await amb.pedir(`${rota}/pdf`, { como: orientadora })).local, rota);

    await amb.pedir(rota, { como: orientadora, corpo: { acao: 'salvar', nota: '8.5', comentarios: 'Dedicado', data_assinatura: '2026-11-12' } });
    assert.match(amb.flash(orientadora).message, /FAPO salva/);
    assert.equal((await faposModel.buscarPorAluno(bruno)).nota, 8.5);

    const gerado = await amb.pedir(rota, { como: orientadora, corpo: { nota: '9', comentarios: 'Ótimo', data_assinatura: '2026-11-12' } });
    assert.equal(nomeDoArquivo(gerado), 'FAPO-Bruno-Brito.pdf');
    await pdf(gerado);
    assert.equal(nomeDoArquivo(await amb.pedir(`${rota}/pdf`, { como: orientadora })), 'FAPO-Bruno-Brito.pdf');
});

test('FAPO de estágio encerrado vira só consulta, mas o PDF continua liberado', async () => {
    await faposModel.salvar({ alunoId: davi, nota: 9, comentarios: '', dataAssinatura: '2026-11-12' });
    await amb.pedir(`/professor/aluno/${davi}/fapo`, { como: orientadora });
    assert.match(amb.flash(orientadora).message, /não pode mais ser alterada/);
    await pdf(await amb.pedir(`/professor/aluno/${davi}/fapo/pdf`, { como: orientadora }));
});

// ── Ata da banca (FARE) ──────────────────────────────────────────────────
const notasBanca = Object.fromEntries([1, 2, 3].flatMap((c) => [1, 2, 3].map((n) => [`banca_${c}_${n}`, '8'])));
const ata = (extra = {}) => ({ periodo: '05/10/2026 a 05/10/2026', nota_fac: '7,5', nota_faa_manual: '9', ...notasBanca,
    avaliador_1: 'Otto Outro', avaliador_2: 'Saulo Supervisor', resultado: 'aprovado', comentarios: 'Ok', data_ata: '2026-11-12', ...extra });

test('ata: só o orientador, depois das horas cumpridas', async () => {
    await amb.pedir(`/professor/aluno/${ana}/fare`, { como: orientadora });
    assert.match(amb.flash(orientadora).message, /depois que o estagiário cumprir/);
    await amb.pedir(`/professor/aluno/${bruno}/fare`, { como: outroProfessor });
    assert.match(amb.flash(outroProfessor).message, /Apenas o professor orientador/);
    const tela = await amb.pedir(`/professor/aluno/${bruno}/fare`, { como: orientadora });
    assert.equal(tela.status, 200);
    assert.match(await tela.text(), /05\/10\/2026 a 05\/10\/2026/);
});

test('ata: rascunho guarda notas; nota fora da faixa volta com o formulário', async () => {
    const rota = `/professor/aluno/${bruno}/fare`;
    await amb.pedir(rota, { como: orientadora, corpo: ata({ banca_2_3: '11' }) });
    assert.match(amb.flash(orientadora).message, /prática profissional \(N3\) deve estar entre 0 e 10/);
    assert.match(await (await amb.pedir(rota, { como: orientadora })).text(), /Otto Outro/);

    await amb.pedir(rota, { como: orientadora, corpo: ata({ data_ata: '2026-02-31' }) });
    assert.match(amb.flash(orientadora).message, /data da ata é inválida/);

    await amb.pedir(rota, { como: orientadora, corpo: ata({ banca_1_1: '' }) });
    assert.equal(amb.flash(orientadora).message, 'Rascunho da ata salvo.');
    const salva = await faresModel.buscarPorAluno(bruno);
    assert.equal(salva.nota_fac, 7.5);
    assert.deepEqual(salva.banca, [[null, 8, 8], [8, 8, 8], [8, 8, 8]]);
});

test('ata: concluir exige FAPO, as nove notas e o que fazer na ressalva', async () => {
    const rota = `/professor/aluno/${bruno}/fare`;
    await amb.pedir(rota, { como: orientadora, corpo: ata({ acao: 'finalizar', banca_3_2: '', resultado: 'aprovado_ressalva' }) });
    const falta = amb.flash(orientadora).message;
    for (const item of ['FAPO', 'as 9 notas da banca', 'o que o estagiário deve fazer na ressalva']) assert.match(falta, new RegExp(item));
    assert.equal((await amb.sql('SELECT encerrado_em FROM alunos WHERE usuario_id = $1', [bruno]))[0].encerrado_em, null);

    await faposModel.salvar({ alunoId: bruno, nota: 9, comentarios: '', dataAssinatura: '2026-11-12' });
    await amb.pedir(rota, { como: orientadora, corpo: ata({ acao: 'finalizar', resultado: 'aprovado_ressalva', corrigir_relatorio: 'on', corrigir_relatorio_ate: '2026-12-01' }) });
    assert.match(amb.flash(orientadora).message, /Estágio concluído/);
    const fare = await faresModel.buscarPorAluno(bruno);
    assert.equal(fare.corrigir_relatorio_ate, '2026-12-01');
    assert.equal(fare.refazer_apresentacao_ate, '');
    assert.ok((await amb.sql('SELECT encerrado_em FROM alunos WHERE usuario_id = $1', [bruno]))[0].encerrado_em);

    // encerrado: não altera mais; o PDF fica pronto
    await amb.pedir(rota, { como: orientadora, corpo: ata({ comentarios: 'mudou' }) });
    assert.match(amb.flash(orientadora).message, /Reabra a ata/);
    assert.equal(nomeDoArquivo(await amb.pedir(`${rota}/pdf`, { como: orientadora })), 'Ata-Banca-Bruno-Brito.pdf');
});

test('ata: a FAA preenchida pelo estudante substitui a nota manual', async () => {
    await faasModel.salvar({ alunoId: bruno, empresa: 'Agro Vale', periodo: 'x', notas: Array(10).fill(6), atividades: 'x',
        respostas: Array(7).fill('sim'), comentarios: '', dataAssinatura: '2026-11-12' });
    await amb.pedir(`/professor/aluno/${bruno}/fare`, { como: orientadora, corpo: ata({ nota_faa_manual: '10' }) });
    assert.equal((await faresModel.buscarPorAluno(bruno)).nota_faa_manual, null);
    assert.match(await (await amb.pedir(`/professor/aluno/${bruno}/fare`, { como: orientadora })).text(), /6,0|6\.0|6,00/);
});

test('PDF da ata: só o orientador e depois de salvar', async () => {
    await amb.pedir(`/professor/aluno/${bruno}/fare/pdf`, { como: outroProfessor });
    assert.match(amb.flash(outroProfessor).message, /Apenas o professor orientador/);
    assert.equal((await amb.pedir(`/professor/aluno/${bruno}/fare/pdf`, { como: orientadora })).local, `/professor/aluno/${bruno}/fare`);
    assert.match(amb.flash(orientadora).message, /Salve a ata/);
});

test('reabrir: orientador volta à ata; administrador também pode; outros não', async () => {
    await amb.pedir(`/professor/aluno/${davi}/fare/reabrir`, { como: outroProfessor, corpo: {} });
    assert.match(amb.flash(outroProfessor).message, /Apenas o orientador ou um administrador/);

    assert.equal((await amb.pedir(`/professor/aluno/${davi}/fare/reabrir`, { como: orientadora, corpo: {} })).local, `/professor/aluno/${davi}/fare`);
    assert.equal((await amb.sql('SELECT encerrado_em FROM alunos WHERE usuario_id = $1', [davi]))[0].encerrado_em, null);

    await amb.sql('UPDATE alunos SET encerrado_em = NOW() WHERE usuario_id = $1', [davi]);
    assert.equal((await amb.pedir(`/professor/aluno/${davi}/fare/reabrir`, { como: admin, corpo: {} })).local, `/professor/aluno/${davi}`);
    assert.equal(await faresModel.reabrir(davi), false);
});

// ── Painel de fichas e fichas para impressão ────────────────────────────
test('painel de fichas separa prontos, em andamento e encerrados', async () => {
    const orientandos = await faresModel.listarPorOrientador(orientadora);
    assert.deepEqual(orientandos.map((o) => o.nome), ['Ana Andrade', 'Bruno Brito', 'Davi Dias']);
    assert.equal(orientandos.find((o) => o.nome === 'Bruno Brito').horas_realizadas, 4);

    const painel = await amb.pedir('/professor/fichas', { como: orientadora });
    assert.equal(painel.status, 200);
    assert.match(await painel.text(), /Bruno Brito/);

    // administrador puro não orienta nem supervisiona
    assert.equal((await amb.pedir('/professor/fichas', { como: admin })).local, '/professor/inicio');
});

test('fichas para impressão: quem tem vínculo ou gestão; estranhos não', async () => {
    for (const quem of [orientadora, supervisor, servidora, admin]) {
        await pdf(await amb.pedir(`/professor/aluno/${davi}/ficha-acompanhamento`, { como: quem }));
    }
    await amb.pedir(`/professor/aluno/${davi}/ficha-acompanhamento`, { como: outroProfessor });
    assert.match(amb.flash(outroProfessor).message, /não tem acesso/);
    await amb.pedir('/professor/aluno/9999/ficha-acompanhamento', { como: orientadora });
    assert.match(amb.flash(orientadora).message, /não encontrado/);

    await amb.pedir(`/professor/aluno/${davi}/faa/pdf`, { como: orientadora });
    assert.match(amb.flash(orientadora).message, /ainda não preencheu a FAA/);
    await faasModel.salvar({ alunoId: davi, empresa: 'Agro Vale', periodo: 'x', notas: Array(10).fill(8), atividades: 'x',
        respostas: Array(7).fill('nao'), comentarios: '', dataAssinatura: '2026-11-12' });
    const faa = await amb.pedir(`/professor/aluno/${davi}/faa/pdf`, { como: supervisor });
    assert.equal(nomeDoArquivo(faa), 'FAA-Davi-Dias.pdf');
    await pdf(faa);
});

test('estagiário em lista de espera não tem ata nem FAPO', async () => {
    await amb.pedir(`/professor/aluno/${carla}/fare`, { como: orientadora });
    assert.match(amb.flash(orientadora).message, /cumprir todas as horas/);
});
