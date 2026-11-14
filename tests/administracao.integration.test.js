// Administração: contas, papéis, aprovação de supervisores externos,
// arquivamento de estagiários e o relatório semanal.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente, PESSOAS, CURSO } = require('./helpers/ambiente');
const { ADMIN_PRINCIPAL_EMAIL } = require('../src/config/constants');

let amb;
let enviados = [];
let falhaSmtp = null;
const { admin, servidora, orientadora, supervisor, externo, externoPendente, outroProfessor, ana, carla, eva } = PESSOAS;

before(async () => {
    amb = await criarAmbiente({
        // o envio manual do relatório usa o SMTP configurado; aqui ele só registra a mensagem
        antesDasRotas() {
            require('../src/services/email').obterConfiguracaoEmail = () => ({
                urlAplicacao: 'https://estagios.example.test', remetente: 'Estágios <estagios@example.test>',
                enderecoRemetente: 'estagios@example.test',
                transporte: { async sendMail(m) { if (falhaSmtp) throw falhaSmtp; enviados.push(m); } },
            });
        },
    });
});
beforeEach(async () => { await amb.semear(); enviados = []; falhaSmtp = null; });
after(async () => { await amb.fechar(); });

test('administração é exclusiva de administradores', async () => {
    assert.equal((await amb.pedir('/professor/administracao', { como: admin })).status, 200);
    assert.equal((await amb.pedir('/professor/administracao', { como: orientadora })).local, '/professor/dashboard');
    assert.match(amb.flash(orientadora).message, /Apenas administradores/);
    assert.equal((await amb.pedir('/professor/professores', { como: admin })).local, '/professor/usuarios');
    assert.equal((await amb.pedir('/professor/cadastros', { como: admin })).local, '/professor/usuarios');
});

test('o acompanhamento geral é do administrador e do setor de estágios', async () => {
    for (const quem of [admin, servidora]) {
        const r = await amb.pedir('/professor/acompanhamento', { como: quem });
        assert.equal(r.status, 200);
        assert.match(await r.text(), /Ana Andrade/);
    }
    assert.equal((await amb.pedir('/professor/acompanhamento', { como: orientadora })).local, '/professor/dashboard');
});

// ── Ativar/desativar e excluir contas ────────────────────────────────────
test('desativar conta: regras de proteção e efeito na sessão', async () => {
    await amb.sql("INSERT INTO usuarios (id, nome, email, tipo, nome_confirmado) VALUES (30, 'Principal', $1, 'professor', true)", [ADMIN_PRINCIPAL_EMAIL]);
    const casos = [
        [`/professor/usuarios/${admin}/ativo`, { ativo: 'false' }, /própria conta/],
        ['/professor/usuarios/9999/ativo', { ativo: 'false' }, /não encontrado/],
        ['/professor/usuarios/30/ativo', { ativo: 'false' }, /administrador principal/],
        [`/professor/usuarios/${ana}/ativo`, { ativo: 'talvez' }, /inválido/],
    ];
    for (const [rota, corpo, mensagem] of casos) {
        await amb.pedir(rota, { como: admin, corpo });
        assert.match(amb.flash(admin).message, mensagem, rota);
    }

    await amb.pedir(`/professor/usuarios/${ana}/ativo`, { como: admin, corpo: { ativo: 'false' } });
    assert.match(amb.flash(admin).message, /desativado/);
    assert.equal((await amb.pedir('/aluno/dashboard', { como: ana })).status, 403);

    await amb.pedir(`/professor/usuarios/${ana}/ativo`, { como: admin, corpo: { ativo: 'true' } });
    assert.equal(amb.flash(admin).message, 'Usuário ativado.');
    assert.equal((await amb.pedir('/aluno/dashboard', { como: ana })).status, 200);

    // só administrador
    await amb.pedir(`/professor/usuarios/${ana}/ativo`, { como: servidora, corpo: { ativo: 'false' } });
    assert.match(amb.flash(servidora).message, /Apenas administradores/);
});

test('excluir conta só quando não há vínculos', async () => {
    await amb.pedir(`/professor/usuarios/${admin}/excluir`, { como: admin, corpo: {} });
    assert.match(amb.flash(admin).message, /própria conta/);
    await amb.pedir('/professor/usuarios/9999/excluir', { como: admin, corpo: {} });
    assert.match(amb.flash(admin).message, /não encontrado/);
    await amb.pedir(`/professor/usuarios/${orientadora}/excluir`, { como: admin, corpo: {} });
    assert.match(amb.flash(admin).message, /vínculos associados/);

    await amb.pedir(`/professor/usuarios/${outroProfessor}/excluir`, { como: admin, corpo: {} });
    assert.equal(amb.flash(admin).message, 'Usuário excluído com sucesso.');
    assert.equal((await amb.sql('SELECT COUNT(*)::int AS n FROM usuarios WHERE id = $1', [outroProfessor]))[0].n, 0);
});

// ── Papéis e cargo ───────────────────────────────────────────────────────
test('papéis: só contas internas, nunca os próprios, e sem largar estudantes', async () => {
    const papeis = (id, lista) => amb.pedir(`/professor/usuarios/${id}/papeis`, { como: admin, corpo: lista.map((p) => ['papeis', p]) });

    await papeis(externo, ['supervisor']);
    assert.match(amb.flash(admin).message, /contas internas/);
    await papeis(admin, ['servidor']);
    assert.match(amb.flash(admin).message, /próprios papéis/);
    await papeis(outroProfessor, []);
    assert.match(amb.flash(admin).message, /ao menos um papel/);
    await papeis(orientadora, ['supervisor']);
    assert.match(amb.flash(admin).message, /ainda orienta 3 estudante/);
    await papeis(supervisor, ['orientador']);
    assert.match(amb.flash(admin).message, /ainda supervisiona/);

    await papeis(outroProfessor, ['servidor', 'admin', 'desconhecido']);
    assert.match(amb.flash(admin).message, /Papéis de Otto Outro atualizados: Administrador, Servidor/);
    const [p] = await amb.sql('SELECT cargo, papel_servidor, papel_orientador, papel_supervisor FROM professores WHERE usuario_id = $1', [outroProfessor]);
    assert.deepEqual(p, { cargo: 'admin', papel_servidor: true, papel_orientador: false, papel_supervisor: false });
});

test('o administrador principal sempre mantém o papel de administrador', async () => {
    await amb.sql("INSERT INTO usuarios (id, nome, email, tipo, nome_confirmado) VALUES (30, 'Principal', $1, 'professor', true)", [ADMIN_PRINCIPAL_EMAIL]);
    await amb.sql("INSERT INTO professores (usuario_id, cargo) VALUES (30, 'admin')");
    await amb.pedir('/professor/usuarios/30/papeis', { como: admin, corpo: { papeis: 'servidor' } });
    const [p] = await amb.sql('SELECT cargo, papel_servidor FROM professores WHERE usuario_id = 30');
    assert.deepEqual(p, { cargo: 'admin', papel_servidor: true });
});

test('cargo: troca de comum para administrador; supervisor externo não tem cargo', async () => {
    await amb.pedir(`/professor/professores/${outroProfessor}/cargo`, { como: admin, corpo: { cargo: 'admin' } });
    assert.equal(amb.flash(admin).message, 'Cargo atualizado com sucesso.');
    assert.equal((await amb.sql('SELECT cargo FROM professores WHERE usuario_id = $1', [outroProfessor]))[0].cargo, 'admin');

    await amb.pedir(`/professor/professores/${externo}/cargo`, { como: admin, corpo: { cargo: 'admin' } });
    assert.match(amb.flash(admin).message, /não pode ser alterado/);

    // o próprio cargo fica como está
    await amb.pedir(`/professor/professores/${admin}/cargo`, { como: admin, corpo: { cargo: 'comum' } });
    assert.equal((await amb.sql('SELECT cargo FROM professores WHERE usuario_id = $1', [admin]))[0].cargo, 'admin');
});

test('aprovar supervisor externo: setor de estágios ou administrador', async () => {
    await amb.pedir(`/professor/supervisores/${externoPendente}/aprovar`, { como: orientadora, corpo: {} });
    assert.match(amb.flash(orientadora).message, /Apenas administradores e servidores/);

    await amb.pedir(`/professor/usuarios/${externoPendente}/aprovar`, { como: servidora, corpo: {} });
    assert.equal(amb.flash(servidora).message, 'Supervisor externo aprovado.');
    assert.equal((await amb.sql('SELECT aprovado FROM professores WHERE usuario_id = $1', [externoPendente]))[0].aprovado, true);

    await amb.pedir(`/professor/supervisores/${externoPendente}/aprovar`, { como: admin, corpo: {} });
    assert.match(amb.flash(admin).message, /já aprovada/);
    await amb.pedir(`/professor/usuarios/${servidora}/aprovar`, { como: servidora, corpo: {} });
    assert.match(amb.flash(servidora).message, /própria solicitação/);
});

// ── Matrícula só com números em todos os cadastros feitos pela equipe ────
test('equipe não grava matrícula com letras ou símbolos', async () => {
    const dados = { nome: 'Ana Andrade', email: 'ana@estudante.test', curso: CURSO };
    await amb.pedir(`/professor/aluno/${ana}/dados`, { como: servidora, corpo: { ...dados, matricula: 'MAT-01' } });
    assert.match(amb.flash(servidora).message, /apenas números/);
    await amb.pedir(`/professor/aluno/${ana}/dados`, { como: servidora, corpo: { ...dados, matricula: '2025 008076' } });
    assert.equal((await amb.sql('SELECT matricula FROM alunos WHERE usuario_id = $1', [ana]))[0].matricula, '2025008076');

    await amb.pedir(`/professor/usuarios/${ana}`, { como: admin, corpo: { ...dados, matricula: 'x1' } });
    assert.match(amb.flash(admin).message, /apenas números/);

    await amb.pedir('/professor/usuarios', { como: admin, corpo: { tipo: 'aluno', nome: 'Gil Gomes', email: 'gil@estudante.test', curso: dados.curso, matricula: '20A5' } });
    assert.match(amb.flash(admin).message, /apenas números/);
    assert.equal((await amb.sql("SELECT COUNT(*)::int AS n FROM usuarios WHERE email = 'gil@estudante.test'"))[0].n, 0);

    const inclusao = await amb.pedir('/professor/estagios', { como: servidora, corpo: { modo: 'novo', nome: 'Gil Gomes', email: 'gil@estudante.test', curso: dados.curso, matricula: 'GIL01', orientador_id: String(orientadora) } });
    assert.equal(inclusao.status, 422);
    assert.match(await inclusao.text(), /apenas números/);
});

// ── Arquivar, desarquivar e excluir estagiário ───────────────────────────
test('arquivar: quem tem vínculo arquiva o encerrado; estágio em andamento só o administrador', async () => {
    const arquivado = async (id) => (await amb.sql('SELECT arquivado FROM alunos WHERE usuario_id = $1', [id]))[0].arquivado;
    await amb.pedir(`/professor/aluno/${ana}/arquivar`, { como: outroProfessor, corpo: {} });
    assert.match(amb.flash(outroProfessor).message, /não pode arquivar/);

    await amb.pedir(`/professor/aluno/${ana}/arquivar`, { como: orientadora, corpo: {} });
    assert.equal(amb.flash(orientadora).message, 'Esse estagiário não pode ser arquivado.');
    assert.equal(await arquivado(ana), false);

    assert.equal((await amb.pedir(`/professor/aluno/${PESSOAS.davi}/arquivar`, { como: orientadora, corpo: {} })).local, '/professor/dashboard');
    assert.match(amb.flash(orientadora).message, /arquivado com sucesso/);
    assert.equal(await arquivado(PESSOAS.davi), true);

    await amb.pedir(`/professor/aluno/${ana}/arquivar`, { como: admin, corpo: {} });
    assert.equal(await arquivado(ana), true);

    assert.equal((await amb.pedir(`/professor/aluno/${ana}/desarquivar`, { como: orientadora, corpo: {} })).local, '/professor/arquivados');
    assert.equal(await arquivado(ana), false);
    assert.equal((await amb.pedir('/professor/arquivados', { como: orientadora })).local, '/professor/dashboard?arquivados=1');
});

test('excluir estagiário: só administrador e sem registros', async () => {
    await amb.pedir(`/professor/aluno/${eva}/excluir`, { como: orientadora, corpo: {} });
    assert.match(amb.flash(orientadora).message, /Apenas administradores/);
    await amb.pedir('/professor/aluno/9999/excluir', { como: admin, corpo: {} });
    assert.match(amb.flash(admin).message, /não encontrado/);

    await amb.sql("INSERT INTO atividades (aluno_id, data, horas, descricao) VALUES ($1, '2026-11-10', 1, 'x')", [eva]);
    await amb.pedir(`/professor/aluno/${eva}/excluir`, { como: admin, corpo: {} });
    assert.match(amb.flash(admin).message, /possui registros ou vínculos/);

    await amb.pedir(`/professor/aluno/${carla}/excluir`, { como: admin, corpo: {} });
    assert.equal(amb.flash(admin).message, 'Estagiário excluído definitivamente.');
    assert.equal((await amb.sql('SELECT COUNT(*)::int AS n FROM usuarios WHERE id = $1', [carla]))[0].n, 0);
});

// ── Relatório semanal ────────────────────────────────────────────────────
test('relatório semanal: programação em intervalos de 15 minutos', async () => {
    assert.equal((await amb.pedir('/professor/relatorio-semanal', { como: admin })).status, 200);
    for (const corpo of [{ dia_semana: '7', horario: '08:00' }, { dia_semana: '1', horario: '08:10' }, { dia_semana: '1', horario: '24:00' }]) {
        await amb.pedir('/professor/relatorio-semanal', { como: admin, corpo });
        assert.match(amb.flash(admin).message, /intervalos de 15 minutos/, JSON.stringify(corpo));
    }
    await amb.pedir('/professor/relatorio-semanal', { como: admin, corpo: { dia_semana: '5', horario: '17:45', habilitado: 'on' } });
    assert.match(amb.flash(admin).message, /ativado/);
    const [config] = await amb.sql("SELECT habilitado, dia_semana, TO_CHAR(horario, 'HH24:MI') AS horario FROM configuracoes_relatorio_semanal");
    assert.deepEqual(config, { habilitado: true, dia_semana: 5, horario: '17:45' });

    await amb.pedir('/professor/relatorio-semanal', { como: admin, corpo: { dia_semana: '5', horario: '17:45' } });
    assert.match(amb.flash(admin).message, /desativado/);
});

test('relatório semanal: envio manual em uma mensagem com os supervisores em cópia oculta', async () => {
    await amb.pedir('/professor/relatorio-semanal/enviar-agora', { como: admin, corpo: {} });
    assert.match(amb.flash(admin).message, /1 supervisor\(es\) em cópia oculta, com 1 estudante/);
    assert.equal(enviados.length, 1);
    assert.deepEqual(enviados[0].bcc, ['supervisor@ifc.edu.br']);
    assert.match(enviados[0].text, /Ana Andrade/);
    assert.match(enviados[0].html, /https:\/\/estagios\.example\.test\/professor\/aluno\/201/);

    // sem ninguém que aceite receber
    await amb.sql('UPDATE professores SET receber_relatorio_semanal = false');
    await amb.pedir('/professor/relatorio-semanal/enviar-agora', { como: admin, corpo: {} });
    assert.match(amb.flash(admin).message, /Nenhum professor elegível/);

    // credencial recusada pelo SMTP
    await amb.sql('UPDATE professores SET receber_relatorio_semanal = true');
    falhaSmtp = Object.assign(new Error('Invalid login'), { code: 'EAUTH' });
    await amb.pedir('/professor/relatorio-semanal/enviar-agora', { como: admin, corpo: {} });
    assert.match(amb.flash(admin).message, /rejeitou as credenciais SMTP/);
    falhaSmtp = new Error('timeout');
    await amb.pedir('/professor/relatorio-semanal/enviar-agora', { como: admin, corpo: {} });
    assert.match(amb.flash(admin).message, /Não foi possível enviar o relatório agora/);
});

test('relatório semanal: lista de destinatários conta os estagiários em andamento', async () => {
    const { listarDestinatarios, buscarConfiguracao } = require('../src/models/relatorioSemanal');
    assert.deepEqual((await listarDestinatarios()).map((d) => [d.nome, d.quantidade_alunos]), [['Saulo Supervisor', 1]]);
    assert.equal((await buscarConfiguracao()).horario, '08:00');
});
