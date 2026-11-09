const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { pool } = require('../src/config/database');
const { executar, montarEmail } = require('../src/scripts/enviarLembretesAtividades');
const facs = require('../src/models/facs');
const { mediaFac } = require('../src/utils/fac');
const { PDFDocument } = require('pdf-lib');
const { gerarFacPdf } = require('../src/services/facPdf');

let db, server, url;
const banco = { connect: async () => ({ query: consultar, release() {} }) };
async function consultar(sql, params) {
    // PGlite é uma instância isolada; advisory locks são exercitados com mocks abaixo.
    if (/pg_(try_advisory_lock|advisory_unlock)/.test(sql)) return { rows: [{ adquirido: true }] };
    const r = await db.query(sql, params);
    return { ...r, rowCount: r.affectedRows ?? r.rows.length };
}
const logger = { log() {}, error() {} };
const raiz = path.join(__dirname, '..');
const form = () => ({ empresa: 'Empresa Exemplo', curso: 'Técnico em Informática', periodo: '01/03/2026 a 01/04/2026',
    atividades: 'Desenvolvimento e testes de sistemas.', comentarios: 'Bom desempenho.',
    local_assinatura: 'Videira', data_assinatura: '2026-11-08',
    ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`nota_${i}`, '8.5'])) });

before(async () => {
    db = new PGlite();
    await db.exec(fs.readFileSync(path.join(raiz, 'db/init.sql'), 'utf8'));
    for (const nome of fs.readdirSync(path.join(raiz, 'db/migrations')).sort().filter((n) => Number(n.slice(0, 3)) > 10)) {
        await db.exec(fs.readFileSync(path.join(raiz, 'db/migrations', nome), 'utf8'));
    }
    // Reexecução é segura, inclusive em instalações novas.
    for (const nome of ['016_lembretes_atividades.sql', '017_ficha_supervisor.sql']) {
        await db.exec(fs.readFileSync(path.join(raiz, 'db/migrations', nome), 'utf8'));
    }
    pool.query = consultar;
    pool.connect = banco.connect;
    const app = express();
    app.set('view engine', 'ejs'); app.set('views', path.join(raiz, 'src/views'));
    app.locals.icone = require('../src/utils/icones').icone;
    app.locals.dataBr = require('../src/utils/datas').formatarDataBr;
    app.locals.dataIso = require('../src/utils/datas').dataParaInput;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
        const id = Number(req.headers['x-test-user'] || 101);
        req.session = {
            user: { id, nome: id === 101 ? 'Supervisor Teste' : 'Usuário Teste', tipo: req.headers['x-test-type'] || ([1, 11].includes(id) ? 'aluno' : 'professor'), cargo: req.headers['x-test-cargo'] || 'comum', supervisorAprovado: true },
            destroy(callback) { delete this.user; callback(); },
        };
        next();
    });
    app.use(require('../src/middleware/auth').attachUser);
    app.use('/professor', require('../src/routes/professor'));
    app.use('/acesso', require('../src/routes/acesso'));
    app.use('/supervisor', require('../src/routes/supervisor'));
    app.use('/aluno', require('../src/routes/aluno'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
    await db.exec(`BEGIN;
        INSERT INTO usuarios (id,nome,email,tipo,nome_confirmado) VALUES
        (101,'Supervisor Teste','supervisor@example.test','professor',true),
        (102,'Orientador Teste','orientador@example.test','professor',true),
        (103,'Outro Professor','outro@example.test','professor',true),
        (104,'Admin Teste','admin@example.test','professor',true),
        (105,'Supervisor Externo','externo@example.test','professor',true);
        INSERT INTO professores (usuario_id,cargo,aprovado) VALUES
        (101,'comum',true),(102,'comum',true),(103,'comum',true),(104,'admin',true),(105,'supervisor',true);
        INSERT INTO usuarios (id,nome,email,tipo,nome_confirmado)
        SELECT n, 'Estudante ' || n, 'aluno' || n || '@example.test', 'aluno', true FROM generate_series(1,10) n
        ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, email=EXCLUDED.email, tipo='aluno';
        INSERT INTO usuarios (id,nome,email,tipo,nome_confirmado)
        VALUES (11,'Novo Usuário Externo','novo@example.test','aluno',true)
        ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome,email=EXCLUDED.email,tipo='aluno';
        SELECT setval(pg_get_serial_sequence('usuarios','id'), (SELECT MAX(id) FROM usuarios));
        INSERT INTO alunos (usuario_id,supervisor_id,orientador_id,status,empresa,relatorio_atualizado_em)
        SELECT n,101,102,'em_andamento','Empresa Exemplo',NOW() - INTERVAL '6 days' FROM generate_series(1,10) n;`);
});
afterEach(async () => { await db.exec('ROLLBACK'); });
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); await db?.close(); await pool.end(); });

function emailTeste(enviadas, sendMail) {
    return { banco, logger, configurarEmail: () => ({ remetente: 'estagios@example.test', urlAplicacao: 'https://estagio.example.test',
        transporte: { sendMail: sendMail || (async (mensagem) => { enviadas.push(mensagem); return { accepted: [mensagem.to.address] }; }) } }) };
}
test('lembretes: mais de 5 dias, apenas ativos, um e-mail individual e intervalo de 7 dias', async () => {
    await db.exec(`UPDATE alunos SET relatorio_atualizado_em = NOW() - INTERVAL '5 days' WHERE usuario_id = 2;
        UPDATE alunos SET relatorio_atualizado_em = NOW() - INTERVAL '4 days' WHERE usuario_id = 3;
        UPDATE alunos SET arquivado = true WHERE usuario_id = 4;
        UPDATE alunos SET encerrado_em = NOW() WHERE usuario_id = 5;
        UPDATE alunos SET status = 'concluido' WHERE usuario_id = 6;
        UPDATE alunos SET status = 'lista_espera' WHERE usuario_id = 7;
        UPDATE alunos SET relatorio_atualizado_em = NOW() WHERE usuario_id >= 8;`);
    const enviadas = [];
    assert.deepEqual(await executar(emailTeste(enviadas)), { enviados: 1, falhas: 0 });
    assert.equal(enviadas[0].to.address, 'aluno1@example.test');
    assert.equal(enviadas[0].bcc, undefined);
    assert.match(enviadas[0].text, /Empresa Exemplo/);
    assert.match(enviadas[0].text, /\/aluno\/nova-atividade/);
    assert.equal((await executar(emailTeste(enviadas))).enviados, 0);
    await db.exec(`UPDATE lembretes_atividades SET proximo_envio_em = NOW() WHERE aluno_id = 1`);
    assert.equal((await executar(emailTeste(enviadas))).enviados, 1);
});
test('registros retroativos e edições reiniciam o prazo; validação do supervisor não reinicia', async () => {
    await db.exec(`INSERT INTO atividades (aluno_id,data,horas,descricao) VALUES (1,'2025-01-01',2,'Registro retroativo');`);
    const atual = await consultar('SELECT relatorio_atualizado_em = NOW() AS recente FROM alunos WHERE usuario_id=1');
    assert.equal(atual.rows[0].recente, true);
    await db.exec(`UPDATE alunos SET relatorio_atualizado_em = NOW() - INTERVAL '6 days' WHERE usuario_id=1;
        UPDATE atividades SET status_validacao='validada', avaliado_em=NOW() WHERE aluno_id=1;`);
    assert.equal((await consultar('SELECT relatorio_atualizado_em < NOW() - INTERVAL \'5 days\' AS antigo FROM alunos WHERE usuario_id=1')).rows[0].antigo, true);
    await db.exec(`UPDATE atividades SET descricao='Descrição corrigida' WHERE aluno_id=1;`);
    assert.equal((await consultar('SELECT relatorio_atualizado_em = NOW() AS recente FROM alunos WHERE usuario_id=1')).rows[0].recente, true);
    await db.exec(`UPDATE alunos SET status='lista_espera' WHERE usuario_id=2; UPDATE alunos SET status='em_andamento' WHERE usuario_id=2;`);
    assert.equal((await consultar('SELECT relatorio_atualizado_em = NOW() AS recente FROM alunos WHERE usuario_id=2')).rows[0].recente, true);
});
test('falha SMTP não impede os demais envios nem causa tentativas a cada execução', async () => {
    const enviadas = [];
    const config = emailTeste(enviadas, async (msg) => {
        if (msg.to.address === 'aluno1@example.test') throw new Error('SMTP indisponível');
        enviadas.push(msg); return {};
    });
    assert.deepEqual(await executar(config), { enviados: 9, falhas: 1 });
    assert.equal((await consultar('SELECT enviado_em FROM lembretes_atividades WHERE aluno_id=1')).rows[0].enviado_em, null);
    assert.deepEqual(await executar(config), { enviados: 0, falhas: 0 });
});
test('outra execução com lock ativo não consulta nem envia destinatários', async () => {
    let consultas = 0, liberado = false;
    const r = await executar({ banco: { connect: async () => ({ query: async () => { consultas++; return { rows: [{ adquirido: false }] }; }, release() { liberado = true; } }) } });
    assert.equal(r.motivo, 'em_execucao'); assert.equal(consultas, 1); assert.equal(liberado, true);
});
test('reserva evita duplicação quando o banco falha depois da aceitação SMTP', async () => {
    await db.exec('UPDATE alunos SET arquivado=true WHERE usuario_id <> 1');
    const enviadas = [];
    const config = emailTeste(enviadas);
    config.banco = { connect: async () => ({ release() {}, query(sql, params) {
        if (sql.startsWith('UPDATE lembretes_atividades SET enviado_em')) throw new Error('Conexão interrompida');
        return consultar(sql, params);
    } }) };
    await assert.rejects(executar(config), /Conexão interrompida/);
    assert.equal(enviadas.length, 1);
    assert.equal((await executar(emailTeste(enviadas))).enviados, 0);
    assert.equal(enviadas.length, 1);
});
test('migração recupera o último registro legado sem reiniciar o prazo na reexecução', async () => {
    await db.exec(`DROP TRIGGER atividades_atualizam_relatorio ON atividades;
        DROP TRIGGER alunos_iniciam_prazo_relatorio ON alunos;
        ALTER TABLE alunos DROP COLUMN relatorio_atualizado_em;
        UPDATE alunos SET criado_em = NOW() - INTERVAL '10 days';
        INSERT INTO atividades (aluno_id,data,horas,descricao,criado_em)
        VALUES (1,'2025-01-01',2,'Registro legado',NOW() - INTERVAL '2 days');`);
    const sql = fs.readFileSync(path.join(raiz, 'db/migrations/016_lembretes_atividades.sql'), 'utf8');
    await db.exec(sql);
    const antes = await consultar('SELECT usuario_id, relatorio_atualizado_em FROM alunos ORDER BY usuario_id');
    await db.exec(sql);
    assert.deepEqual((await consultar('SELECT usuario_id, relatorio_atualizado_em FROM alunos ORDER BY usuario_id')).rows, antes.rows);
    assert.equal((await consultar(`SELECT relatorio_atualizado_em = NOW() - INTERVAL '2 days' AS correto FROM alunos WHERE usuario_id=1`)).rows[0].correto, true);
    assert.equal((await consultar(`SELECT relatorio_atualizado_em = NOW() - INTERVAL '10 days' AS correto FROM alunos WHERE usuario_id=2`)).rows[0].correto, true);
});
test('HTML do lembrete escapa dados do estudante', () => {
    const { html } = montarEmail({ nome: '<script>alert(1)</script>', empresa: 'A & B', carga_horaria: 60 }, 'https://example.test');
    assert.doesNotMatch(html, /<script>/); assert.match(html, /A &amp; B/);
});

async function requisitar(rota, { user = 101, cargo, tipo, body, method = 'GET' } = {}) {
    const parametros = new URLSearchParams();
    Object.entries(body || {}).forEach(([chave, valor]) => {
        (Array.isArray(valor) ? valor : [valor]).forEach((item) => parametros.append(chave, item));
    });
    return fetch(url + rota, { method, redirect: 'manual', headers: { 'x-test-user': String(user), ...(cargo ? { 'x-test-cargo': cargo } : {}), ...(tipo ? { 'x-test-type': tipo } : {}), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: body ? parametros : undefined });
}
test('dashboard unifica orientandos e supervisionados na mesma tabela', async () => {
    await db.exec(`UPDATE alunos SET orientador_id=101 WHERE usuario_id=2;
        UPDATE alunos SET supervisor_id=103, orientador_id=101 WHERE usuario_id=3;`);

    const todos = await requisitar('/professor/dashboard?f=1');
    assert.equal(todos.status, 200);
    const todosHtml = await todos.text();
    assert.doesNotMatch(todosHtml, /aria-label="Filtrar por papel"/);
    assert.doesNotMatch(todosHtml, /name="papel"/);
    assert.match(todosHtml, /Orientando/);
    assert.match(todosHtml, /Supervisionado/);
    assert.match(todosHtml, /href="\/professor\/aluno\/1"/);
    assert.match(todosHtml, /href="\/professor\/aluno\/2"/);
    assert.match(todosHtml, /href="\/professor\/aluno\/3"/);
    assert.doesNotMatch(todosHtml, /href="\/professor\/dashboard\?aba=orientandos"/);
    assert.doesNotMatch(todosHtml, /href="\/professor\/dashboard\?aba=supervisionados"/);

    const legado = await requisitar('/professor/dashboard?f=1&papel=orientando');
    const legadoHtml = await legado.text();
    assert.match(legadoHtml, /href="\/professor\/aluno\/1"/);
    assert.match(legadoHtml, /href="\/professor\/aluno\/2"/);
    assert.match(legadoHtml, /href="\/professor\/aluno\/3"/);
});
test('supervisor externo só vê estudantes atribuídos e não acessa funções de professor', async () => {
    await db.exec(`UPDATE alunos SET supervisor_id=105 WHERE usuario_id=1;
        UPDATE alunos SET orientador_id=105 WHERE usuario_id=2;`);

    const dashboard = await requisitar('/professor/dashboard?f=1', { user: 105, cargo: 'supervisor' });
    assert.equal(dashboard.status, 200);
    const html = await dashboard.text();
    assert.match(html, /href="\/professor\/aluno\/1"/);
    assert.doesNotMatch(html, /href="\/professor\/aluno\/2"/);
    assert.doesNotMatch(html, /Arquivados/);
    assert.doesNotMatch(html, /arquivar/);

    const estudanteDeOutroPapel = await requisitar('/professor/aluno/2', { user: 105, cargo: 'supervisor' });
    assert.equal(estudanteDeOutroPapel.status, 403);
    const administracao = await requisitar('/professor/professores', { user: 105, cargo: 'supervisor' });
    assert.equal(administracao.status, 302);
    assert.equal(administracao.headers.get('location'), '/professor/dashboard');

    const usuarios = require('../src/models/usuarios');
    assert.equal((await usuarios.listarProfessores()).some((p) => p.id === 105), false);
    assert.equal((await usuarios.listarSupervisores()).some((p) => p.id === 105), true);
});
test('supervisor aprovado ou orientador aprova supervisor externo e supervisor pendente fica bloqueado', async () => {
    await db.exec(`INSERT INTO usuarios (id,nome,email,tipo,nome_confirmado)
        VALUES (106,'Pendente','pendente@example.test','professor',true),
               (107,'Outro Pendente','outropendente@example.test','professor',true);
        INSERT INTO professores (usuario_id,cargo,aprovado) VALUES (106,'supervisor',false),(107,'supervisor',false);`);

    const atribuicaoPendente = await requisitar('/professor/aluno/1', {
        method: 'POST',
        body: { empresa: 'Empresa Exemplo', carga_horaria: '60', status: 'em_andamento', supervisor_id: '106', orientador_id: '102' },
    });
    assert.equal(atribuicaoPendente.status, 302);
    assert.equal((await consultar('SELECT supervisor_id FROM alunos WHERE usuario_id=1')).rows[0].supervisor_id, 101);

    const painel = await requisitar('/professor/usuarios', { user: 104 });
    const painelHtml = await painel.text();
    assert.match(painelHtml, /pendente@example\.test/);
    assert.match(painelHtml, /outropendente@example\.test/);
    const bloqueado = await requisitar('/professor/dashboard', { user: 106, cargo: 'supervisor' });
    assert.equal(bloqueado.status, 302);
    assert.equal(bloqueado.headers.get('location'), '/supervisor/pendente');
    const telaPendente = await requisitar('/supervisor/pendente', { user: 106, cargo: 'supervisor' });
    assert.equal(telaPendente.status, 200);
    assert.match(await telaPendente.text(), /Acesso de supervisor em análise/);

    const filaBloqueada = await requisitar('/professor/usuarios', { user: 106, cargo: 'supervisor' });
    assert.equal(filaBloqueada.headers.get('location'), '/supervisor/pendente');
    let result = await consultar('SELECT aprovado FROM professores WHERE usuario_id=106');
    assert.equal(result.rows[0].aprovado, false);

    const autoAprovacao = await requisitar('/professor/usuarios/106/aprovar', { user: 106, cargo: 'supervisor', method: 'POST' });
    assert.equal(autoAprovacao.status, 302);
    result = await consultar('SELECT aprovado FROM professores WHERE usuario_id=106');
    assert.equal(result.rows[0].aprovado, false);

    const aprovado = await requisitar('/professor/usuarios/106/aprovar', { user: 105, method: 'POST' });
    assert.equal(aprovado.status, 302);
    assert.equal(aprovado.headers.get('location'), '/professor/usuarios');
    result = await consultar('SELECT aprovado FROM professores WHERE usuario_id=106');
    assert.equal(result.rows[0].aprovado, true);
    const aprovadoPorOrientador = await requisitar('/professor/usuarios/107/aprovar', { user: 102, method: 'POST' });
    assert.equal(aprovadoPorOrientador.status, 302);
    result = await consultar('SELECT aprovado FROM professores WHERE usuario_id=107');
    assert.equal(result.rows[0].aprovado, true);

    const atribuicaoComoOrientador = await requisitar('/professor/aluno/1', {
        method: 'POST',
        body: { empresa: 'Empresa Exemplo', carga_horaria: '60', status: 'em_andamento', supervisor_id: '101', orientador_id: '105' },
    });
    assert.equal(atribuicaoComoOrientador.status, 302);
    assert.equal((await consultar('SELECT orientador_id FROM alunos WHERE usuario_id=1')).rows[0].orientador_id, 102);
});
test('conta externa escolhe estudante ou solicita perfil de supervisor com empresa e função', async () => {
    const escolha = await requisitar('/acesso/perfil', { user: 11 });
    assert.equal(escolha.status, 200);
    const tela = await escolha.text();
    assert.match(tela, /Continuar como estudante/);
    assert.match(tela, /Sou supervisor externo/);

    const continuar = await requisitar('/acesso/perfil', {
        user: 11, method: 'POST', body: { tipo: 'aluno' },
    });
    assert.equal(continuar.status, 302);
    assert.equal(continuar.headers.get('location'), '/aluno/dashboard');

    const incompleto = await requisitar('/acesso/perfil', {
        user: 11, method: 'POST', body: { tipo: 'supervisor', empresa: '', funcao: '' },
    });
    assert.equal(incompleto.status, 302);
    assert.equal((await consultar('SELECT tipo FROM usuarios WHERE id=11')).rows[0].tipo, 'aluno');

    const pedido = await requisitar('/acesso/perfil', {
        user: 11, method: 'POST',
        body: { tipo: 'supervisor', empresa: 'Empresa Externa', funcao: 'Engenheira de Produção' },
    });
    assert.equal(pedido.status, 302);
    assert.equal(pedido.headers.get('location'), '/supervisor/pendente');
    const perfil = await consultar(`SELECT u.tipo,p.cargo,p.aprovado,p.empresa_externa,p.funcao_externa
        FROM usuarios u JOIN professores p ON p.usuario_id=u.id WHERE u.id=11`);
    assert.deepEqual(perfil.rows[0], {
        tipo: 'professor', cargo: 'supervisor', aprovado: false,
        empresa_externa: 'Empresa Externa', funcao_externa: 'Engenheira de Produção',
    });
    const pendente = await requisitar('/supervisor/pendente', { user: 11, tipo: 'professor', cargo: 'supervisor' });
    assert.match(await pendente.text(), /Empresa Externa/);
    const painelProfessor = await requisitar('/professor/usuarios', { user: 104 });
    const painelHtml = await painelProfessor.text();
    assert.match(painelHtml, /Engenheira de Produção/);

    const contaEstudante = await requisitar('/acesso/perfil', {
        user: 1, method: 'POST', body: { tipo: 'supervisor', empresa: 'Outra', funcao: 'Supervisora' },
    });
    assert.equal(contaEstudante.status, 302);
    assert.equal((await consultar('SELECT tipo FROM usuarios WHERE id=1')).rows[0].tipo, 'aluno');
});
test('aprovação e edição salvam a escala semanal e rejeitam jornadas acima de 6 horas', async () => {
    await db.exec("UPDATE alunos SET status='lista_espera' WHERE usuario_id=1");
    const resposta = await requisitar('/professor/cadastro-aluno/1', {
        method: 'POST',
        body: {
            empresa: 'Empresa Exemplo',
            carga_horaria: '60',
            dias_trabalho: ['1', '6'],
            horario_inicio_1: '08:00',
            horario_fim_1: '12:00',
            horario_inicio_6: '09:00',
            horario_fim_6: '14:00',
        },
    });
    assert.equal(resposta.status, 302);
    assert.deepEqual((await consultar('SELECT horario_trabalho FROM alunos WHERE usuario_id=1')).rows[0].horario_trabalho, {
        1: { inicio: '08:00', fim: '12:00' },
        6: { inicio: '09:00', fim: '14:00' },
    });
    const dashboard = await requisitar('/aluno/dashboard?aba=atividades', { user: 1 });
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /Dia planejado/);
    const novaAtividade = await requisitar('/aluno/nova-atividade', { user: 1 });
    assert.equal(novaAtividade.status, 200);
    assert.match(await novaAtividade.text(), /Segunda-feira, 08:00–12:00/);

    await requisitar('/professor/aluno/1', {
        method: 'POST',
        body: {
            empresa: 'Empresa Exemplo',
            carga_horaria: '60',
            dias_trabalho: ['2'],
            horario_inicio_2: '08:00',
            horario_fim_2: '14:01',
        },
    });
    assert.deepEqual((await consultar('SELECT horario_trabalho FROM alunos WHERE usuario_id=1')).rows[0].horario_trabalho, {
        1: { inicio: '08:00', fim: '12:00' },
        6: { inicio: '09:00', fim: '14:00' },
    });
});
test('registro de atividade permite sábado e rejeita domingo', async () => {
    const sábado = await requisitar('/aluno/nova-atividade', {
        user: 1,
        method: 'POST',
        body: {
            data: '2026-11-14',
            hora_inicio: '09:00',
            hora_fim: '12:00',
            descricao: 'Atividade de sábado',
        },
    });
    assert.equal(sábado.status, 302);
    assert.equal((await consultar("SELECT COUNT(*)::int AS total FROM atividades WHERE aluno_id=1 AND data='2026-11-14'")).rows[0].total, 1);

    const domingo = await requisitar('/aluno/nova-atividade', {
        user: 1,
        method: 'POST',
        body: {
            data: '2026-11-15',
            hora_inicio: '09:00',
            hora_fim: '12:00',
            descricao: 'Atividade de domingo',
        },
    });
    assert.equal(domingo.status, 302);
    assert.equal((await consultar("SELECT COUNT(*)::int AS total FROM atividades WHERE aluno_id=1 AND data='2026-11-15'")).rows[0].total, 0);
});
test('dashboard só exibe arquivamento para status permitidos, exceto para admins', async () => {
    const renderAcoes = (status, encerradoEm, cargo = 'comum') => ejs.renderFile(
        path.join(raiz, 'src/views/partials/aluno_acoes.ejs'),
        { a: { usuario_id: 1, status, encerrado_em: encerradoEm, arquivado: false }, user: { id: 101, cargo }, icone: () => '' }
    );
    for (const [status, encerradoEm, cargo, esperado] of [
        ['lista_espera', null, 'comum', true],
        ['em_andamento', null, 'comum', false],
        ['concluido', null, 'comum', false],
        ['concluido', '2026-11-09', 'comum', true],
        ['em_andamento', null, 'admin', true],
    ]) {
        const html = await renderAcoes(status, encerradoEm, cargo);
        assert.equal(html.includes('/arquivar'), esperado, `${cargo}: ${status}, encerrado=${Boolean(encerradoEm)}`);
    }
});
test('arquivamento: professor comum só arquiva lista de espera ou estágio encerrado; admin pode arquivar qualquer status', async () => {
    await db.exec(`UPDATE alunos SET status='lista_espera' WHERE usuario_id=2;
        UPDATE alunos SET status='concluido' WHERE usuario_id IN (3,4,6);
        UPDATE alunos SET encerrado_em=NOW() WHERE usuario_id=4;`);

    for (const id of [1, 3]) {
        const resposta = await requisitar(`/professor/aluno/${id}/arquivar`, { method: 'POST' });
        assert.equal(resposta.status, 302);
        assert.equal((await consultar('SELECT arquivado FROM alunos WHERE usuario_id=$1', [id])).rows[0].arquivado, false);
    }

    for (const id of [2, 4]) {
        const resposta = await requisitar(`/professor/aluno/${id}/arquivar`, { method: 'POST' });
        assert.equal(resposta.status, 302);
        assert.equal((await consultar('SELECT arquivado FROM alunos WHERE usuario_id=$1', [id])).rows[0].arquivado, true);
    }

    for (const id of [5, 6]) {
        const resposta = await requisitar(`/professor/aluno/${id}/arquivar`, { method: 'POST', user: 104 });
        assert.equal(resposta.status, 302);
        assert.equal((await consultar('SELECT arquivado FROM alunos WHERE usuario_id=$1', [id])).rows[0].arquivado, true);
    }
});
test('painel único cadastra tipos de conta, aprova supervisor e ativa/desativa usuários', async () => {
    const acessoNegado = await requisitar('/professor/usuarios', { user: 101 });
    assert.equal(acessoNegado.status, 200);
    assert.doesNotMatch(await acessoNegado.text(), /Todos os usuários/);

    const painel = await requisitar('/professor/usuarios', { user: 104 });
    assert.equal(painel.status, 200);
    const html = await painel.text();
    assert.match(html, /Adicionar usuário/);
    assert.match(html, /Todos os usuários/);
    assert.doesNotMatch(html, /Solicitações de supervisores externos/);
    assert.match(html, /aria-sort=/);
    assert.match(html, /pagination/);
    const segundaPagina = await requisitar('/professor/usuarios?pagina=2', { user: 104 });
    assert.match(await segundaPagina.text(), /Supervisor Externo/);
    const cadastro = await requisitar('/professor/usuarios/novo', { user: 104 });
    assert.equal(cadastro.status, 200);
    assert.match(await cadastro.text(), /data-admin-user-form/);

    const paginaFiltrada = await requisitar('/professor/usuarios?tipo=aluno&situacao=ativo&ordenar=nome&dir=desc', { user: 104 });
    assert.equal(paginaFiltrada.status, 200);
    const paginaFiltradaHtml = await paginaFiltrada.text();
    assert.match(paginaFiltradaHtml, /Todos os usuários/);
    const totalFiltrado = await consultar(`SELECT COUNT(*)::int AS total FROM usuarios u
        LEFT JOIN professores p ON p.usuario_id=u.id WHERE u.tipo='aluno' AND u.ativo=true`);
    assert.match(paginaFiltradaHtml, new RegExp(`de ${totalFiltrado.rows[0].total} usuários`));

    for (const [tipo, suffix, extra] of [
        ['aluno', 'estudante', { matricula: 'ADM123' }],
        ['professor', 'professor', {}],
        ['supervisor', 'supervisor', { empresa: 'Empresa Nova', funcao: 'Gestor de Estágio' }],
    ]) {
        const resposta = await requisitar('/professor/usuarios', {
            user: 104, method: 'POST',
            body: { nome: `Conta ${suffix}`, email: `${suffix}.novo@example.test`, tipo, ...extra },
        });
        assert.equal(resposta.status, 302);
        const conta = await consultar(`SELECT u.id,u.tipo,u.ativo,p.cargo,p.aprovado,p.empresa_externa,p.funcao_externa,a.matricula
            FROM usuarios u LEFT JOIN professores p ON p.usuario_id=u.id
            LEFT JOIN alunos a ON a.usuario_id=u.id WHERE u.email=$1`, [`${suffix}.novo@example.test`]);
        assert.equal(conta.rows.length, 1);
        assert.equal(conta.rows[0].ativo, true);
        if (tipo === 'aluno') assert.equal(conta.rows[0].matricula, 'ADM123');
        if (tipo === 'professor') assert.equal(conta.rows[0].cargo, 'comum');
        if (tipo === 'supervisor') {
            assert.equal(conta.rows[0].cargo, 'supervisor');
            assert.equal(conta.rows[0].aprovado, false);
            assert.equal(conta.rows[0].empresa_externa, 'Empresa Nova');
            assert.equal(conta.rows[0].funcao_externa, 'Gestor de Estágio');
            const aprovado = await requisitar(`/professor/usuarios/${conta.rows[0].id}/aprovar`, { user: 104, method: 'POST' });
            assert.equal(aprovado.status, 302);
        }
    }

    const emailDuplicado = await requisitar('/professor/usuarios', {
        user: 104, method: 'POST',
        body: { nome: 'Duplicado', email: 'ALUNO1@EXAMPLE.TEST', tipo: 'aluno' },
    });
    assert.equal(emailDuplicado.status, 302);
    assert.equal(emailDuplicado.headers.get('location'), '/professor/usuarios/novo');
    assert.equal((await consultar(`SELECT COUNT(*)::int AS total FROM usuarios
        WHERE LOWER(email)=LOWER('aluno1@example.test')`)).rows[0].total, 1);

    const desativar = await requisitar('/professor/usuarios/2/ativo', {
        user: 104, method: 'POST', body: { ativo: 'false' },
    });
    assert.equal(desativar.status, 302);
    const contaDesativada = await consultar('SELECT ativo FROM usuarios WHERE id=2');
    assert.equal(contaDesativada.rows[0].ativo, false);
    const sessaoExistente = await requisitar('/aluno/dashboard', { user: 2, tipo: 'aluno' });
    assert.equal(sessaoExistente.status, 403);

    const estadoInvalido = await requisitar('/professor/usuarios/3/ativo', {
        user: 104, method: 'POST', body: { ativo: 'valor-invalido' },
    });
    assert.equal(estadoInvalido.status, 302);
    assert.equal((await consultar('SELECT ativo FROM usuarios WHERE id=3')).rows[0].ativo, true);

    const propriaConta = await requisitar('/professor/usuarios/104/ativo', {
        user: 104, method: 'POST', body: { ativo: 'false' },
    });
    assert.equal(propriaConta.status, 302);
    assert.equal((await consultar('SELECT ativo FROM usuarios WHERE id=104')).rows[0].ativo, true);
});
test('FAC: supervisor preenche, persiste notas e média; aluno e orientador consultam PDF', async () => {
    await db.exec(`UPDATE alunos SET status='concluido' WHERE usuario_id=1;`);
    assert.equal((await requisitar('/professor/aluno/1/fac', { method: 'POST', body: form() })).status, 302);
    const fac = await facs.buscarPorAluno(1);
    assert.equal(fac.nota, 8.5); assert.equal(fac.supervisor_nome, 'Supervisor Teste');
    const tela = await requisitar('/professor/aluno/1/fac'); assert.equal(tela.status, 200);
    assert.match(await tela.text(), /Média 8,5/);
    for (const [rota, user] of [['/professor/aluno/1/fac/pdf', 102], ['/aluno/fac/pdf', 1]]) {
        const pdf = await requisitar(rota, { user });
        assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/);
        assert.equal((await PDFDocument.load(await pdf.arrayBuffer())).getPageCount(), 2);
    }
    for (const [rota, user] of [['/professor/fichas', 101], ['/professor/aluno/1', 101], ['/aluno/dashboard?aba=fichas', 1], ['/professor/aluno/1/fare', 102]]) {
        const r = await requisitar(rota, { user }); assert.equal(r.status, 200, rota);
        assert.match(await r.text(), /FAC/);
    }
});
test('FAC: permissões, encerramento, arquivamento e dados inválidos bloqueiam alterações', async () => {
    assert.equal((await requisitar('/professor/aluno/1/fac', { method: 'POST', body: form() })).status, 403);
    await db.exec(`UPDATE alunos SET status='concluido' WHERE usuario_id=1;`);
    for (const user of [102, 103]) assert.equal((await requisitar('/professor/aluno/1/fac', { user, method: 'POST', body: form() })).status, 403);
    assert.equal((await requisitar('/professor/aluno/1/fac/pdf', { user: 103 })).status, 403);
    for (const alteracao of [{ nota_0: '' }, { nota_1: '11' }, { nota_2: '-1' }, { nota_3: 'NaN' }, { nota_4: '1.55' }, { data_assinatura: '2026-02-30' }, { curso: '' }]) {
        assert.equal((await requisitar('/professor/aluno/1/fac', { method: 'POST', body: { ...form(), ...alteracao } })).status, 422);
    }
    assert.equal(await facs.buscarPorAluno(1), null);
    await db.exec('UPDATE alunos SET encerrado_em=NOW() WHERE usuario_id=1');
    assert.equal((await requisitar('/professor/aluno/1/fac', { method: 'POST', body: form() })).status, 403);
    await db.exec('UPDATE alunos SET encerrado_em=NULL, arquivado=true WHERE usuario_id=1');
    assert.equal((await requisitar('/professor/aluno/1/fac', { method: 'POST', body: form() })).status, 403);
});
test('ata usa média da FAC salva e ignora nota forjada no formulário', async () => {
    await db.exec(`UPDATE alunos SET status='concluido' WHERE usuario_id=1;`);
    await requisitar('/professor/aluno/1/fac', { method: 'POST', body: form() });
    const r = await requisitar('/professor/aluno/1/fare', { user: 102, method: 'POST', body: { acao: 'salvar', nota_fac: '10' } });
    assert.equal(r.status, 302);
    assert.equal(Number((await consultar('SELECT nota_fac FROM fares WHERE aluno_id=1')).rows[0].nota_fac), 8.5);
});
test('PDF preserva textos longos em anexo e média aceita zero', async () => {
    assert.equal(mediaFac(Array(10).fill(0)), 0);
    assert.equal(mediaFac([...Array(5).fill(8.4), ...Array(5).fill(8.5)]), 8.5);
    const bytes = await gerarFacPdf({ aluno: { nome: 'Estudante Teste', orientador_nome: 'Orientador Teste' }, fac: {
        ...form(), notas: Array(10).fill(10), atividades: 'Atividade detalhada. '.repeat(70), comentarios: 'Comentário extenso. '.repeat(70), supervisor_nome: 'Supervisor Teste',
    } });
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 4);
});
