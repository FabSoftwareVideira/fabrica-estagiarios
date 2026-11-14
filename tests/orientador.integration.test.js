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
