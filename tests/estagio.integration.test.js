const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { pool } = require('../src/config/database');
const { executar, montarEmail } = require('../src/scripts/enviarLembretesAtividades');
const { executarJob } = require('../src/scripts/lembretesAtividadesJob');
const facs = require('../src/models/facs');
const fichasRascunhos = require('../src/models/fichasRascunhos');
const { mediaFac } = require('../src/utils/fac');
const { PDFDocument } = require('pdf-lib');
const { gerarFacPdf } = require('../src/services/facPdf');
const { estagioStatus, etapaAtual } = require('../src/config/status');

let db, server, url;
const banco = {
    query: consultar,
    connect: async () => ({
        async query(sql, params) {
            if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql)) return { rows: [], rowCount: 0 };
            return consultar(sql, params);
        },
        release() {},
    }),
};
async function consultar(sql, params) {
    // PGlite é uma instância isolada; advisory locks são exercitados com mocks abaixo.
    if (/pg_(try_advisory_lock|advisory_unlock)/.test(sql)) return { rows: [{ adquirido: true }] };
    const r = await db.query(sql, params);
    return { ...r, rowCount: r.affectedRows ?? r.rows.length };
}
const logger = { log() {}, error() {} };
const raiz = path.join(__dirname, '..');
test('status arquivado prevalece sobre o status operacional sem alterar a etapa do estágio', () => {
    const aluno = { status: 'em_andamento', arquivado: true, encerrado_em: null };
    assert.deepEqual(estagioStatus(aluno), {
        chave: 'arquivado',
        label: 'Arquivado',
        classe: 'status-archived',
    });
    assert.equal(etapaAtual(aluno), 1);
});
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
            regenerate(callback) { delete this.user; callback(); },
        };
        next();
    });
    app.use(require('../src/middleware/auth').attachUser);
    app.use(require('../src/routes/auth'));
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
        INSERT INTO alunos (usuario_id,supervisor_id,orientador_id,status,empresa,relatorio_atualizado_em,curso)
        SELECT n,101,102,'em_andamento','Empresa Exemplo',NOW() - INTERVAL '6 days',
            'Curso Técnico de Agropecuária Integrado ao Ensino Médio'
        FROM generate_series(1,10) n;`);
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

test('lembretes: simulação conta apenas contas ativas com preferência ligada sem reservar envios', async () => {
    await db.exec(`UPDATE usuarios SET ativo=false WHERE id=1;
        UPDATE usuarios SET receber_lembretes_atividades=false WHERE id=2;`);
    const enviadas = [];
    const config = emailTeste(enviadas);
    config.configurarEmail = () => { throw new Error('Simulação não deve acessar SMTP'); };
    assert.deepEqual(await executarJob({ ...config, modo: 'simular' }), { modo: 'simular', elegiveis: 8 });
    assert.equal((await consultar('SELECT COUNT(*)::int AS total FROM lembretes_atividades')).rows[0].total, 0);
    assert.deepEqual(await executar(emailTeste(enviadas)), { enviados: 8, falhas: 0 });
    assert.ok(enviadas.every((m) => !['aluno1@example.test', 'aluno2@example.test'].includes(m.to.address)));
});

test('lembretes: diagnóstico autentica SMTP sem enviar nem consumir o intervalo', async () => {
    let verificacoes = 0, fechou = false;
    const resultado = await executarJob({ banco, logger, configurarEmail: () => ({ transporte: {
        async verify() { verificacoes++; },
        async sendMail() { assert.fail('Diagnóstico não pode enviar mensagens'); },
        close() { fechou = true; },
    } }) });
    assert.deepEqual(resultado, { modo: 'diagnostico', elegiveis: 10, smtp: true });
    assert.equal(verificacoes, 1); assert.equal(fechou, true);
    assert.equal((await consultar('SELECT COUNT(*)::int AS total FROM lembretes_atividades')).rows[0].total, 0);
});

test('lembretes: banco antigo ou trigger desativado bloqueia execução antes do SMTP', async () => {
    const config = { banco, logger, modo: 'enviar', configurarEmail: () => { assert.fail('SMTP não deve ser iniciado'); } };
    await db.exec('ALTER TABLE atividades DISABLE TRIGGER atividades_atualizam_relatorio');
    await assert.rejects(executarJob(config), /Banco não preparado.*trigger atividades_atualizam_relatorio/);
    await db.exec('ALTER TABLE atividades ENABLE TRIGGER atividades_atualizam_relatorio');
    await db.exec('ALTER TABLE usuarios DROP COLUMN receber_lembretes_atividades');
    await assert.rejects(executarJob(config), /usuarios.receber_lembretes_atividades.*runMigrations/);
});

test('lembretes: falha no diagnóstico libera SMTP sem registrar lembrete', async () => {
    let fechou = false;
    await assert.rejects(executarJob({ banco, logger, configurarEmail: () => ({ transporte: {
        async verify() { throw new Error('Autenticação SMTP recusada'); }, close() { fechou = true; },
    } }) }), /Autenticação SMTP recusada/);
    assert.equal(fechou, true);
    assert.equal((await consultar('SELECT COUNT(*)::int AS total FROM lembretes_atividades')).rows[0].total, 0);
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
test('histórico de atividades do estudante fica ao lado do calendário e limita a descrição visualmente', async () => {
    await db.exec("INSERT INTO atividades (aluno_id,data,horas,descricao) VALUES (1,'2026-11-09',2,'Descrição completa para validar o truncamento visual')");
    const resposta = await requisitar('/aluno/dashboard?aba=atividades', { user: 1 });
    assert.equal(resposta.status, 200);
    const html = await resposta.text();
    assert.match(html, /class="card atividade-calendario"/);
    assert.match(html, /<div class="atividade-layout">[\s\S]*<div class="card atividade-calendario">[\s\S]*<section class="card atividade-historico">/);
    assert.match(html, /<table class="activity-history-table">[\s\S]*<th>Descrição<\/th>/);
    assert.match(html, /class="activity-description" title="/);
});
test('cadastro de estudante exige um curso válido e guarda apenas uma opção', async () => {
    const cursos = require('../src/config/cursos').CURSOS;
    const formulario = await requisitar('/aluno/completar-cadastro', { user: 11 });
    assert.equal(formulario.status, 200);
    const html = await formulario.text();
    for (const curso of cursos) assert.ok(html.includes(curso));

    const semCurso = await requisitar('/aluno/completar-cadastro', {
        user: 11, method: 'POST', body: { nome: 'Novo estudante', matricula: 'NOVO11', avatarEmoji: '🐱' },
    });
    assert.equal(semCurso.status, 302);
    assert.equal((await consultar('SELECT usuario_id FROM alunos WHERE usuario_id=11')).rows.length, 0);

    const cursoInvalido = await requisitar('/aluno/completar-cadastro', {
        user: 11, method: 'POST', body: { nome: 'Novo estudante', matricula: 'NOVO11', curso: 'Curso inventado', avatarEmoji: '🐱' },
    });
    assert.equal(cursoInvalido.status, 302);
    assert.equal((await consultar('SELECT usuario_id FROM alunos WHERE usuario_id=11')).rows.length, 0);

    const cursoEscolhido = cursos[1];
    const cadastro = await requisitar('/aluno/completar-cadastro', {
        user: 11, method: 'POST', body: { nome: 'Novo estudante', matricula: 'NOVO11', curso: cursoEscolhido, avatarEmoji: '🐱' },
    });
    assert.equal(cadastro.status, 302);
    assert.equal((await consultar('SELECT curso FROM alunos WHERE usuario_id=11')).rows[0].curso, cursoEscolhido);
});
test('perfil permite informar ou corrigir o curso para um único curso cadastrado', async () => {
    const cursos = require('../src/config/cursos').CURSOS;
    const pagina = await requisitar('/perfil', { user: 1 });
    assert.equal(pagina.status, 200);
    const html = await pagina.text();
    for (const curso of cursos) assert.ok(html.includes(curso));

    const invalido = await requisitar('/perfil', {
        user: 1, method: 'POST', body: { nome: 'Estudante 1', matricula: 'TESTE1', curso: 'Curso inválido', avatarEmoji: '🐱' },
    });
    assert.equal(invalido.status, 302);
    assert.equal((await consultar('SELECT curso FROM alunos WHERE usuario_id=1')).rows[0].curso, cursos[0]);

    const alterado = await requisitar('/perfil', {
        user: 1, method: 'POST', body: { nome: 'Estudante 1', matricula: 'TESTE1', curso: cursos[2], avatarEmoji: '🐱' },
    });
    assert.equal(alterado.status, 302);
    assert.equal((await consultar('SELECT curso FROM alunos WHERE usuario_id=1')).rows[0].curso, cursos[2]);
});
test('orientador pode corrigir o curso; outros professores e cursos inválidos são recusados', async () => {
    const cursoInformatica = 'Curso Técnico em Informática Integrado ao Ensino Médio';
    const semPermissao = await requisitar('/professor/aluno/1/curso', {
        user: 101, method: 'POST', body: { curso: cursoInformatica },
    });
    assert.equal(semPermissao.status, 302);
    assert.equal((await consultar('SELECT curso FROM alunos WHERE usuario_id=1')).rows[0].curso,
        'Curso Técnico de Agropecuária Integrado ao Ensino Médio');

    const invalido = await requisitar('/professor/aluno/1/curso', {
        user: 102, method: 'POST', body: { curso: 'Curso não cadastrado' },
    });
    assert.equal(invalido.status, 302);
    assert.equal((await consultar('SELECT curso FROM alunos WHERE usuario_id=1')).rows[0].curso,
        'Curso Técnico de Agropecuária Integrado ao Ensino Médio');

    const atualizado = await requisitar('/professor/aluno/1/curso', {
        user: 102, method: 'POST', body: { curso: cursoInformatica },
    });
    assert.equal(atualizado.status, 302);
    assert.equal((await consultar('SELECT curso FROM alunos WHERE usuario_id=1')).rows[0].curso, cursoInformatica);
    const detalhes = await requisitar('/professor/aluno/1', { user: 102 });
    assert.match(await detalhes.text(), /Curso do estudante/);

    // o curso também pode ser trocado pelo formulário "Editar estágio"
    const cursoAgro = 'Curso Técnico de Agropecuária Integrado ao Ensino Médio';
    const edicao = {
        empresa: 'Empresa Exemplo', carga_horaria: '60', status: 'em_andamento', orientador_id: '102',
        dias_trabalho: ['1'], horario_inicio_1: '08:00', horario_fim_1: '12:00', curso: cursoAgro,
    };
    const outroProfessor = await requisitar('/professor/aluno/1', { user: 101, method: 'POST', body: edicao });
    assert.equal(outroProfessor.headers.get('location'), '/professor/aluno/1?aba=estagio');
    assert.equal((await consultar('SELECT curso FROM alunos WHERE usuario_id=1')).rows[0].curso, cursoInformatica);
    await requisitar('/professor/aluno/1', { user: 102, method: 'POST', body: edicao });
    assert.equal((await consultar('SELECT curso FROM alunos WHERE usuario_id=1')).rows[0].curso, cursoAgro);
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

    // FAA, FAPO, banca e ata (FARE) ficam fora do alcance do supervisor
    for (const rota of [
        '/professor/aluno/1/faa/pdf',
        '/professor/aluno/1/fapo',
        '/professor/aluno/1/fapo/pdf',
        '/professor/aluno/1/banca',
        '/professor/aluno/1/fare',
        '/professor/aluno/1/fare/pdf',
        '/professor/fichas',
        '/professor/bancas',
    ]) {
        const bloqueada = await requisitar(rota, { user: 105, cargo: 'supervisor' });
        assert.equal(bloqueada.status, 302, rota);
        assert.equal(bloqueada.headers.get('location'), '/professor/dashboard', rota);
    }

    // o vocabulário do supervisor usa "Supervisionados" em vez de "Alunos"
    assert.match(html, /Supervisionados/);
    const detalhe = await requisitar('/professor/aluno/1', { user: 105, cargo: 'supervisor' });
    const detalheHtml = await detalhe.text();
    assert.match(detalheHtml, /Supervisionados/);
    assert.doesNotMatch(detalheHtml, /\/faa\/pdf/);
    assert.doesNotMatch(detalheHtml, /\/fapo/);
    assert.doesNotMatch(detalheHtml, /\/fare/);
    assert.doesNotMatch(detalheHtml, /\/banca/);

    // mesmo com o estágio concluído, supervisor não vê FAA, FAPO, banca nem ata
    await db.exec("UPDATE alunos SET status='concluido' WHERE usuario_id=1");
    const concluido = await requisitar('/professor/aluno/1', { user: 105, cargo: 'supervisor' });
    const concluidoHtml = await concluido.text();
    assert.doesNotMatch(concluidoHtml, /FAA/);
    assert.doesNotMatch(concluidoHtml, /FAPO/);
    assert.doesNotMatch(concluidoHtml, /Ata da banca/);
    assert.doesNotMatch(concluidoHtml, /Agendamento da banca/);
    assert.match(concluidoHtml, /FAC/);
    assert.match(concluidoHtml, /Horas cumpridas — preencha a FAC/);

    // o painel do supervisor usa cards (sem tabela) e destaca a FAC ao cumprir as horas
    assert.match(html, /supervisionado-card/);
    assert.doesNotMatch(html, /<table/);

    // o supervisor filtra apenas por "Em andamento" ou "Concluído"
    assert.match(html, /name="situacao" value="andamento"/);
    assert.match(html, /name="situacao" value="concluido"/);
    assert.doesNotMatch(html, /name="status" value="lista_espera"/);
    assert.doesNotMatch(html, /Aguardando banca/);
    assert.doesNotMatch(html, /Lista de espera/);

    const painelConcluido = await requisitar('/professor/dashboard?f=1', { user: 105, cargo: 'supervisor' });
    const painelConcluidoHtml = await painelConcluido.text();
    assert.match(painelConcluidoHtml, /supervisionado-card/);
    assert.doesNotMatch(painelConcluidoHtml, /<table/);
    assert.match(painelConcluidoHtml, /Preencher FAC/);
    assert.match(painelConcluidoHtml, /href="\/professor\/aluno\/1\/fac"/);
    assert.doesNotMatch(painelConcluidoHtml, /Avaliações FAC/);

    // card em destaque reúne quem concluiu as horas e está com FAC pendente
    assert.match(painelConcluidoHtml, /fac-destaque/);
    assert.match(painelConcluidoHtml, /id="fac-pendentes"/);

    // filtros simplificados: em andamento esconde o concluído da lista (o destaque permanece)
    const somenteAndamento = await requisitar('/professor/dashboard?f=1&situacao=andamento', { user: 105, cargo: 'supervisor' });
    const andamentoHtml = await somenteAndamento.text();
    assert.match(andamentoHtml, /Nenhum supervisionado encontrado/);
    assert.match(andamentoHtml, /fac-destaque/);

    const somenteConcluido = await requisitar('/professor/dashboard?f=1&situacao=concluido', { user: 105, cargo: 'supervisor' });
    const concluidoFiltroHtml = await somenteConcluido.text();
    assert.match(concluidoFiltroHtml, /supervisionado-card/);
    assert.match(concluidoFiltroHtml, /Concluído/);

    // a página separada de avaliações foi removida do menu e das rotas
    const avaliacoes = await requisitar('/professor/avaliacoes', { user: 105, cargo: 'supervisor' });
    assert.equal(avaliacoes.status, 302);
    assert.equal(avaliacoes.headers.get('location'), '/professor/dashboard');

    const usuarios = require('../src/models/usuarios');
    assert.equal((await usuarios.listarProfessores()).some((p) => p.id === 105), false);
    assert.equal((await usuarios.listarSupervisores()).some((p) => p.id === 105), true);
});
test('só administrador e setor de estágios aprovam supervisor externo; supervisor pendente fica bloqueado', async () => {
    await db.exec(`INSERT INTO usuarios (id,nome,email,tipo,nome_confirmado)
        VALUES (106,'Pendente','pendente@example.test','professor',true),
               (107,'Outro Pendente','outropendente@example.test','professor',true);
        INSERT INTO professores (usuario_id,cargo,aprovado) VALUES (106,'supervisor',false),(107,'supervisor',false);`);

    const atribuicaoPendente = await requisitar('/professor/aluno/1', {
        user: 102, method: 'POST',
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
    // supervisor externo aprovado e professor comum não veem a fila nem o aviso
    for (const [user, cargo] of [[105, 'supervisor'], [102, undefined]]) {
        const fila = await requisitar('/professor/usuarios', { user, cargo });
        assert.equal(fila.status, 302, `fila ${user}`);
        assert.doesNotMatch(await (await requisitar('/professor/dashboard', { user, cargo })).text(), /Revisar solicitações/);
    }
    let result = await consultar('SELECT aprovado FROM professores WHERE usuario_id=106');
    assert.equal(result.rows[0].aprovado, false);

    const autoAprovacao = await requisitar('/professor/usuarios/106/aprovar', { user: 106, cargo: 'supervisor', method: 'POST' });
    assert.equal(autoAprovacao.status, 302);
    result = await consultar('SELECT aprovado FROM professores WHERE usuario_id=106');
    assert.equal(result.rows[0].aprovado, false);

    // outro supervisor externo e um orientador comum não aprovam ninguém
    for (const [user, cargo] of [[105, 'supervisor'], [102, undefined]]) {
        for (const rota of ['/professor/usuarios/106/aprovar', '/professor/supervisores/106/aprovar']) {
            assert.equal((await requisitar(rota, { user, cargo, method: 'POST' })).status, 302);
        }
    }
    result = await consultar('SELECT aprovado FROM professores WHERE usuario_id=106');
    assert.equal(result.rows[0].aprovado, false);

    const aprovado = await requisitar('/professor/usuarios/106/aprovar', { user: 104, cargo: 'admin', method: 'POST' });
    assert.equal(aprovado.status, 302);
    assert.equal(aprovado.headers.get('location'), '/professor/usuarios');
    result = await consultar('SELECT aprovado FROM professores WHERE usuario_id=106');
    assert.equal(result.rows[0].aprovado, true);
    // o setor de estágios vê a fila e também aprova
    await db.exec('UPDATE professores SET papel_servidor=true WHERE usuario_id=103');
    assert.match(await (await requisitar('/professor/usuarios', { user: 103 })).text(), /outropendente@example[.]test/);
    const aprovadoPeloSetor = await requisitar('/professor/usuarios/107/aprovar', { user: 103, method: 'POST' });
    assert.equal(aprovadoPeloSetor.status, 302);
    result = await consultar('SELECT aprovado FROM professores WHERE usuario_id=107');
    assert.equal(result.rows[0].aprovado, true);

    const atribuicaoComoOrientador = await requisitar('/professor/aluno/1', {
        user: 102, method: 'POST',
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
            orientador_id: '102',
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
        user: 102, method: 'POST',
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
test('estudante edita atividade e uma avaliação anterior volta para pendente', async () => {
    await db.exec(`INSERT INTO atividades
        (aluno_id,data,hora_inicio,hora_fim,horas,descricao,status_validacao,avaliado_por,avaliado_em)
        VALUES (1,'2026-11-09','09:00','11:00',2,'Atividade original','validada',101,NOW());`);
    const atividade = (await consultar("SELECT id FROM atividades WHERE aluno_id=1 AND descricao='Atividade original'")).rows[0];

    const formulario = await requisitar(`/aluno/atividade/${atividade.id}/editar`, { user: 1 });
    assert.equal(formulario.status, 200);
    const html = await formulario.text();
    assert.match(html, /Editar atividade/);
    assert.match(html, /voltará para <strong>pendente/);
    assert.match(html, new RegExp(`/aluno/atividade/${atividade.id}/editar`));

    const salvar = await requisitar(`/aluno/atividade/${atividade.id}/editar`, {
        user: 1,
        method: 'POST',
        body: {
            data: '2026-11-10',
            hora_inicio: '10:00',
            hora_fim: '13:00',
            descricao: 'Atividade atualizada',
        },
    });
    assert.equal(salvar.status, 302);
    const atualizada = await consultar(`SELECT data,hora_inicio,hora_fim,horas,descricao,status_validacao,
        avaliado_por,avaliado_em FROM atividades WHERE id=$1`, [atividade.id]);
    assert.deepEqual({
        ...atualizada.rows[0],
        data: atualizada.rows[0].data.toISOString().slice(0, 10),
    }, {
        data: '2026-11-10',
        hora_inicio: '10:00:00',
        hora_fim: '13:00:00',
        horas: '3.00',
        descricao: 'Atividade atualizada',
        status_validacao: 'pendente',
        avaliado_por: null,
        avaliado_em: null,
    });
});
test('estudante não edita atividade de outra conta nem depois de concluir ou arquivar o estágio', async () => {
    await db.exec(`INSERT INTO atividades (aluno_id,data,hora_inicio,hora_fim,horas,descricao)
        VALUES (1,'2026-11-09','09:00','11:00',2,'Atividade protegida');`);
    const atividade = (await consultar("SELECT id FROM atividades WHERE aluno_id=1 AND descricao='Atividade protegida'")).rows[0];

    const deOutroAluno = await requisitar(`/aluno/atividade/${atividade.id}/editar`, { user: 2 });
    assert.equal(deOutroAluno.status, 302);
    assert.equal(deOutroAluno.headers.get('location'), '/aluno/dashboard?aba=atividades');

    await db.exec("UPDATE alunos SET status='concluido' WHERE usuario_id=1");
    const concluido = await requisitar(`/aluno/atividade/${atividade.id}/editar`, { user: 1 });
    assert.equal(concluido.status, 302);
    assert.equal(concluido.headers.get('location'), '/aluno/dashboard');

    await db.exec("UPDATE alunos SET status='em_andamento', arquivado=true WHERE usuario_id=1");
    const arquivado = await requisitar(`/aluno/atividade/${atividade.id}/editar`, {
        user: 1,
        method: 'POST',
        body: { data: '2026-11-10', hora_inicio: '10:00', hora_fim: '12:00', descricao: 'Alteração bloqueada' },
    });
    assert.equal(arquivado.status, 302);
    const preservada = await consultar('SELECT descricao,status_validacao FROM atividades WHERE id=$1', [atividade.id]);
    assert.equal(preservada.rows[0].descricao, 'Atividade protegida');
    assert.equal(preservada.rows[0].status_validacao, 'pendente');
});
test('edição mantém limite de seis horas no dia', async () => {
    await db.exec(`INSERT INTO atividades (aluno_id,data,hora_inicio,hora_fim,horas,descricao)
        VALUES (1,'2026-11-09','08:00','10:00',2,'Atividade a editar'),
               (1,'2026-11-10','08:00','12:00',4,'Outra atividade');`);
    const atividade = (await consultar("SELECT id FROM atividades WHERE descricao='Atividade a editar'")).rows[0];
    const resposta = await requisitar(`/aluno/atividade/${atividade.id}/editar`, {
        user: 1,
        method: 'POST',
        body: { data: '2026-11-10', hora_inicio: '12:00', hora_fim: '15:00', descricao: 'Acima do limite' },
    });
    assert.equal(resposta.status, 302);
    const semAlteracao = await consultar('SELECT data,descricao FROM atividades WHERE id=$1', [atividade.id]);
    assert.equal(semAlteracao.rows[0].data.toISOString().slice(0, 10), '2026-11-09');
    assert.equal(semAlteracao.rows[0].descricao, 'Atividade a editar');
});
test('estudante exclui atividade própria com ícone minimalista e remove as horas validadas', async () => {
    await db.exec(`INSERT INTO atividades
        (aluno_id,data,hora_inicio,hora_fim,horas,descricao,status_validacao,avaliado_por,avaliado_em)
        VALUES (1,'2026-11-09','09:00','12:00',3,'Atividade a excluir','validada',101,NOW());`);
    const atividade = (await consultar("SELECT id FROM atividades WHERE aluno_id=1 AND descricao='Atividade a excluir'")).rows[0];
    const dashboard = await requisitar('/aluno/dashboard?aba=atividades', { user: 1 });
    const html = await dashboard.text();
    assert.match(html, new RegExp(`/aluno/atividade/${atividade.id}/excluir`));
    assert.match(html, /aria-label="Excluir atividade/);
    assert.match(html, /data-confirmar="Excluir esta atividade/);

    const excluir = await requisitar(`/aluno/atividade/${atividade.id}/excluir`, {
        user: 1,
        method: 'POST',
    });
    assert.equal(excluir.status, 302);
    assert.equal(excluir.headers.get('location'), '/aluno/dashboard?aba=atividades');
    assert.equal((await consultar('SELECT id FROM atividades WHERE id=$1', [atividade.id])).rows.length, 0);
    assert.equal((await consultar(`SELECT COALESCE(SUM(horas),0)::numeric AS total FROM atividades
        WHERE aluno_id=1 AND status_validacao='validada'`)).rows[0].total, '0');
});
test('estudante não exclui atividade alheia ou após concluir ou arquivar o estágio', async () => {
    await db.exec(`INSERT INTO atividades (aluno_id,data,hora_inicio,hora_fim,horas,descricao)
        VALUES (1,'2026-11-09','09:00','11:00',2,'Atividade protegida');`);
    const atividade = (await consultar("SELECT id FROM atividades WHERE aluno_id=1 AND descricao='Atividade protegida'")).rows[0];

    const deOutroAluno = await requisitar(`/aluno/atividade/${atividade.id}/excluir`, {
        user: 2,
        method: 'POST',
    });
    assert.equal(deOutroAluno.status, 302);
    assert.equal((await consultar('SELECT id FROM atividades WHERE id=$1', [atividade.id])).rows.length, 1);

    await db.exec("UPDATE alunos SET status='concluido' WHERE usuario_id=1");
    const concluido = await requisitar(`/aluno/atividade/${atividade.id}/excluir`, {
        user: 1,
        method: 'POST',
    });
    assert.equal(concluido.status, 302);
    assert.equal((await consultar('SELECT id FROM atividades WHERE id=$1', [atividade.id])).rows.length, 1);

    await db.exec("UPDATE alunos SET status='em_andamento', arquivado=true WHERE usuario_id=1");
    const arquivado = await requisitar(`/aluno/atividade/${atividade.id}/excluir`, {
        user: 1,
        method: 'POST',
    });
    assert.equal(arquivado.status, 302);
    assert.equal((await consultar('SELECT id FROM atividades WHERE id=$1', [atividade.id])).rows.length, 1);
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

    // professor sem vínculo com o estudante não arquiva nem desarquiva
    await db.exec("UPDATE alunos SET status='concluido', encerrado_em=NOW() WHERE usuario_id=7");
    await requisitar('/professor/aluno/7/arquivar', { method: 'POST', user: 103 });
    assert.equal((await consultar('SELECT arquivado FROM alunos WHERE usuario_id=7')).rows[0].arquivado, false);
    await requisitar('/professor/aluno/2/desarquivar', { method: 'POST', user: 103 });
    assert.equal((await consultar('SELECT arquivado FROM alunos WHERE usuario_id=2')).rows[0].arquivado, true);
    await requisitar('/professor/aluno/2/desarquivar', { method: 'POST' });
    assert.equal((await consultar('SELECT arquivado FROM alunos WHERE usuario_id=2')).rows[0].arquivado, false);
    // cadastro na lista de espera ainda sem orientador pode ser arquivado por qualquer professor
    await db.exec("UPDATE alunos SET status='lista_espera', orientador_id=NULL, supervisor_id=NULL WHERE usuario_id=8");
    await requisitar('/professor/aluno/8/arquivar', { method: 'POST', user: 103 });
    assert.equal((await consultar('SELECT arquivado FROM alunos WHERE usuario_id=8')).rows[0].arquivado, true);
});
test('dados e fichas do estudante só abrem para responsáveis, banca e gestão; carga horária é validada', async () => {
    const rotas = ['/professor/aluno/1', '/professor/aluno/1/ficha-acompanhamento', '/professor/aluno/1/banca'];
    for (const rota of rotas) {
        const semVinculo = await requisitar(rota, { user: 103 });
        assert.ok([302, 403].includes(semVinculo.status), `${rota}: ${semVinculo.status}`);
        for (const user of [101, 102, 104]) {
            assert.equal((await requisitar(rota, { user, cargo: user === 104 ? 'admin' : undefined })).status, 200, `${rota} para ${user}`);
        }
    }
    assert.equal((await requisitar('/professor/aluno/1/faa/pdf', { user: 103 })).headers.get('location'), '/professor/inicio');

    // avaliador da banca consulta o estudante
    await db.exec(`UPDATE alunos SET status='concluido' WHERE usuario_id=1;
        INSERT INTO bancas (aluno_id,orientador_id,avaliador_1_id,avaliador_2_id,data,hora_inicio,hora_fim,sala,situacao,atualizado_por)
        VALUES (1,102,103,104,'2030-01-10','09:00','10:00','Sala 1','agendada',102)`);
    assert.equal((await requisitar('/professor/aluno/1', { user: 103 })).status, 200);

    // carga horária: só horas inteiras de 1 a 9999
    for (const carga of ['0', '-5', 'abc', '10.5', '100000']) {
        await requisitar('/professor/aluno/2', { user: 102, method: 'POST',
            body: { empresa: 'Empresa Exemplo', carga_horaria: carga, orientador_id: '102' } });
        const linha = (await consultar('SELECT carga_horaria, status FROM alunos WHERE usuario_id=2')).rows[0];
        assert.equal(linha.carga_horaria, 60, `carga ${carga}`);
        assert.equal(linha.status, 'em_andamento');
    }
    await db.exec("UPDATE alunos SET status='lista_espera', orientador_id=NULL WHERE usuario_id=3");
    await requisitar('/professor/cadastro-aluno/3', { user: 103, method: 'POST',
        body: { empresa: 'Empresa Exemplo', carga_horaria: '0', orientador_id: '102' } });
    assert.equal((await consultar('SELECT status FROM alunos WHERE usuario_id=3')).rows[0].status, 'lista_espera');
});
test('painel único cadastra tipos de conta, aprova supervisor e ativa/desativa usuários', async () => {
    const acessoNegado = await requisitar('/professor/usuarios', { user: 101 });
    assert.equal(acessoNegado.status, 302);

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
    const cadastroHtml = await cadastro.text();
    assert.match(cadastroHtml, /data-usuario-form/);
    for (const curso of require('../src/config/cursos').CURSOS) assert.ok(cadastroHtml.includes(curso));

    const paginaFiltrada = await requisitar('/professor/usuarios?tipo=aluno&situacao=ativo&ordenar=nome&dir=desc', { user: 104 });
    assert.equal(paginaFiltrada.status, 200);
    const paginaFiltradaHtml = await paginaFiltrada.text();
    assert.match(paginaFiltradaHtml, /Todos os usuários/);
    const totalFiltrado = await consultar(`SELECT COUNT(*)::int AS total FROM usuarios u
        LEFT JOIN professores p ON p.usuario_id=u.id WHERE u.tipo='aluno' AND u.ativo=true`);
    assert.match(paginaFiltradaHtml, new RegExp(`de ${totalFiltrado.rows[0].total} usuários`));

    for (const [tipo, suffix, extra] of [
        ['aluno', 'estudante', { matricula: 'ADM123', curso: 'Curso Técnico em Informática Integrado ao Ensino Médio' }],
        ['professor', 'professor', {}],
        ['supervisor', 'supervisor', { empresa: 'Empresa Nova', funcao: 'Gestor de Estágio' }],
    ]) {
        const resposta = await requisitar('/professor/usuarios', {
            user: 104, method: 'POST',
            body: { nome: `Conta ${suffix}`, email: `${suffix}.novo@example.test`, tipo, ...extra },
        });
        assert.equal(resposta.status, 302);
        const conta = await consultar(`SELECT u.id,u.tipo,u.ativo,p.cargo,p.aprovado,p.empresa_externa,p.funcao_externa,a.matricula,a.curso
            FROM usuarios u LEFT JOIN professores p ON p.usuario_id=u.id
            LEFT JOIN alunos a ON a.usuario_id=u.id WHERE u.email=$1`, [`${suffix}.novo@example.test`]);
        assert.equal(conta.rows.length, 1);
        assert.equal(conta.rows[0].ativo, true);
        if (tipo === 'aluno') {
            assert.equal(conta.rows[0].matricula, 'ADM123');
            assert.equal(conta.rows[0].curso, extra.curso);
        }
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

    const cursoInvalido = await requisitar('/professor/usuarios', {
        user: 104, method: 'POST',
        body: { nome: 'Curso inválido', email: 'curso.invalido@example.test', tipo: 'aluno', curso: 'Outro curso' },
    });
    assert.equal(cursoInvalido.status, 302);
    assert.equal((await consultar("SELECT id FROM usuarios WHERE email='curso.invalido@example.test'")).rows.length, 0);
    const cursoAusente = await requisitar('/professor/usuarios', {
        user: 104, method: 'POST',
        body: { nome: 'Curso ausente', email: 'curso.ausente@example.test', tipo: 'aluno' },
    });
    assert.equal(cursoAusente.status, 302);
    assert.equal((await consultar("SELECT id FROM usuarios WHERE email='curso.ausente@example.test'")).rows.length, 0);

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
test('admin exclui contas sem vínculos e preserva as que têm dados associados', async () => {
    await db.exec(`INSERT INTO alunos (usuario_id) VALUES (11);
        INSERT INTO atividades (aluno_id,data,horas,descricao) VALUES (1,'2026-11-08',1,'Registro associado');
        UPDATE alunos SET supervisor_id=105 WHERE usuario_id=2;`);

    const alunoVinculado = await requisitar('/professor/usuarios/1/excluir', {
        user: 104, method: 'POST',
    });
    assert.equal(alunoVinculado.status, 302);
    assert.equal((await consultar('SELECT id FROM usuarios WHERE id=1')).rows.length, 1);
    assert.equal((await consultar('SELECT aluno_id FROM atividades WHERE aluno_id=1')).rows.length, 1);

    const supervisorVinculado = await requisitar('/professor/usuarios/105/excluir', {
        user: 104, method: 'POST',
    });
    assert.equal(supervisorVinculado.status, 302);
    assert.equal((await consultar('SELECT id FROM usuarios WHERE id=105')).rows.length, 1);

    const propriaConta = await requisitar('/professor/usuarios/104/excluir', {
        user: 104, method: 'POST',
    });
    assert.equal(propriaConta.status, 302);
    assert.equal((await consultar('SELECT id FROM usuarios WHERE id=104')).rows.length, 1);

    const alunoSemVinculos = await requisitar('/professor/usuarios/11/excluir', {
        user: 104, method: 'POST',
    });
    assert.equal(alunoSemVinculos.status, 302);
    assert.equal((await consultar('SELECT id FROM usuarios WHERE id=11')).rows.length, 0);
    assert.equal((await consultar('SELECT usuario_id FROM alunos WHERE usuario_id=11')).rows.length, 0);
});
test('exclusão de aluno arquivado é exclusiva do admin e bloqueada se houver registros', async () => {
    await db.exec(`UPDATE alunos SET arquivado=true WHERE usuario_id=1;
        INSERT INTO atividades (aluno_id,data,horas,descricao) VALUES (1,'2026-11-08',1,'Registro associado');`);

    const comoProfessor = await requisitar('/professor/aluno/1/excluir', {
        user: 101, method: 'POST',
    });
    assert.equal(comoProfessor.status, 302);
    assert.equal((await consultar('SELECT id FROM usuarios WHERE id=1')).rows.length, 1);
    assert.equal((await consultar('SELECT id FROM atividades WHERE aluno_id=1')).rows.length, 1);

    const comoAdmin = await requisitar('/professor/aluno/1/excluir', {
        user: 104, method: 'POST',
    });
    assert.equal(comoAdmin.status, 302);
    assert.equal((await consultar('SELECT id FROM usuarios WHERE id=1')).rows.length, 1);
    assert.equal((await consultar('SELECT id FROM atividades WHERE aluno_id=1')).rows.length, 1);

    await db.exec('DELETE FROM atividades WHERE aluno_id=1');
    const semRegistro = await requisitar('/professor/aluno/1/excluir', {
        user: 104, method: 'POST',
    });
    assert.equal(semRegistro.status, 302);
    assert.equal((await consultar('SELECT id FROM usuarios WHERE id=1')).rows.length, 0);
});
test('FAC: supervisor preenche, persiste notas e média; aluno e orientador consultam PDF', async () => {
    await db.exec(`UPDATE alunos SET status='concluido' WHERE usuario_id=1;`);
    assert.equal((await requisitar('/professor/aluno/1/fac', { method: 'POST', body: form() })).status, 302);
    const fac = await facs.buscarPorAluno(1);
    assert.equal(fac.nota, 8.5); assert.equal(fac.supervisor_nome, 'Supervisor Teste');
    assert.equal(fac.curso, 'Curso Técnico de Agropecuária Integrado ao Ensino Médio');
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
test('FAA permite salvar rascunho parcial e continuar após nova requisição', async () => {
    await db.exec(`UPDATE alunos SET status='concluido' WHERE usuario_id=1;`);
    const salvamento = await requisitar('/aluno/faa', {
        user: 1, method: 'POST',
        body: { acao: 'rascunho', periodo: '01/09/2026 a 30/09/2026', atividades: 'Atendimento e organização', nota_1: '8.5' },
    });
    assert.equal(salvamento.status, 302);
    assert.equal(await consultar('SELECT aluno_id FROM faas WHERE aluno_id=1').then((r) => r.rows.length), 0);
    const rascunho = await fichasRascunhos.buscar(1, 'FAA');
    assert.equal(rascunho.dados.periodo, '01/09/2026 a 30/09/2026');
    assert.equal(rascunho.dados.notas[0], '8.5');
    const tela = await requisitar('/aluno/faa', { user: 1 });
    const html = await tela.text();
    assert.equal(tela.status, 200);
    assert.match(html, /value="01\/09\/2026 a 30\/09\/2026"/);
    assert.match(html, /name="nota_1"[^>]*value="8\.5"/);
    assert.match(html, /Salvar rascunho/);
    const finalizacao = await requisitar('/aluno/faa', {
        user: 1, method: 'POST',
        body: {
            acao: 'salvar',
            periodo: '01/09/2026 a 30/09/2026',
            atividades: 'Atendimento e organização',
            data_assinatura: '2026-09-30',
            comentarios: '',
            ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`nota_${i + 1}`, '8'])),
            ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`q_${i + 1}`, 'sim'])),
        },
    });
    assert.equal(finalizacao.status, 302);
    assert.equal(await fichasRascunhos.buscar(1, 'FAA'), null);
});
test('FAPO e FAC permitem salvar e retomar rascunhos parciais', async () => {
    await db.exec(`UPDATE alunos SET status='concluido' WHERE usuario_id=1;`);
    const fapoPost = await requisitar('/professor/aluno/1/fapo', {
        user: 102, method: 'POST',
        body: { acao: 'rascunho', comentarios: 'Acompanhamento em andamento' },
    });
    assert.equal(fapoPost.status, 302);
    assert.equal((await fichasRascunhos.buscar(1, 'FAPO')).dados.comentarios, 'Acompanhamento em andamento');
    const fapoTela = await requisitar('/professor/aluno/1/fapo', { user: 102 });
    assert.equal(fapoTela.status, 200);
    assert.match(await fapoTela.text(), /Acompanhamento em andamento/);
    const fapoFinal = await requisitar('/professor/aluno/1/fapo', {
        user: 102, method: 'POST',
        body: { acao: 'salvar', nota: '8.5', comentarios: 'Avaliação completa', data_assinatura: '2026-09-30' },
    });
    assert.equal(fapoFinal.status, 302);
    assert.equal(await fichasRascunhos.buscar(1, 'FAPO'), null);

    const facPost = await requisitar('/professor/aluno/1/fac', {
        user: 101, method: 'POST',
        body: { acao: 'rascunho', periodo: '01/09/2026 a 30/09/2026', nota_0: '7.5' },
    });
    assert.equal(facPost.status, 302);
    assert.equal(await consultar('SELECT aluno_id FROM facs WHERE aluno_id=1').then((r) => r.rows.length), 0);
    assert.equal((await fichasRascunhos.buscar(1, 'FAC')).dados.notas[0], '7.5');
    const facTela = await requisitar('/professor/aluno/1/fac', { user: 101 });
    assert.equal(facTela.status, 200);
    const facTelaHtml = await facTela.text();
    assert.match(facTelaHtml, /value="7\.5"/);
    assert.match(facTelaHtml, /id="empresa"[^>]*maxlength="60"/);
    assert.match(facTelaHtml, /id="periodo"[^>]*maxlength="35"/);
    assert.match(facTelaHtml, /id="nota_0"[^>]*step="0\.01"/);
    assert.match(facTelaHtml, /id="atividades"[^>]*rows="2"/);
    assert.match(facTelaHtml, /id="atividades"[^>]*maxlength="300"/);
    assert.match(facTelaHtml, /id="comentarios"[^>]*rows="2"/);
    assert.match(facTelaHtml, /id="comentarios"[^>]*maxlength="300"/);
    assert.match(facTelaHtml, /placeholder="0,00"/);
    const facFinal = await requisitar('/professor/aluno/1/fac', {
        user: 101, method: 'POST', body: form(),
    });
    assert.equal(facFinal.status, 302);
    assert.equal(await fichasRascunhos.buscar(1, 'FAC'), null);
});
test('rascunho da ata já é salvo no banco e pode ser continuado', async () => {
    await db.exec(`UPDATE alunos SET status='concluido' WHERE usuario_id=1;`);
    const salvamento = await requisitar('/professor/aluno/1/fare', {
        user: 102, method: 'POST',
        body: { acao: 'salvar', periodo: '01/09/2026 a 30/09/2026', comentarios: 'Revisar banca', banca_1_1: '8' },
    });
    assert.equal(salvamento.status, 302);
    const fare = (await consultar('SELECT periodo, comentarios, banca FROM fares WHERE aluno_id=1')).rows[0];
    assert.equal(fare.periodo, '01/09/2026 a 30/09/2026');
    assert.equal(fare.comentarios, 'Revisar banca');
    assert.equal(fare.banca[0][0], 8);
    assert.equal((await consultar('SELECT encerrado_em FROM alunos WHERE usuario_id=1')).rows[0].encerrado_em, null);
});
test('FAC: permissões, encerramento, arquivamento e dados inválidos bloqueiam alterações', async () => {
    assert.equal((await requisitar('/professor/aluno/1/fac', { method: 'POST', body: form() })).status, 403);
    await db.exec(`UPDATE alunos SET status='concluido' WHERE usuario_id=1;`);
    for (const user of [102, 103]) assert.equal((await requisitar('/professor/aluno/1/fac', { user, method: 'POST', body: form() })).status, 403);
    assert.equal((await requisitar('/professor/aluno/1/fac/pdf', { user: 103 })).status, 403);
    for (const alteracao of [{ nota_0: '' }, { nota_1: '11' }, { nota_2: '-1' }, { nota_3: 'NaN' }, { nota_4: '1.555' }, { data_assinatura: '2026-02-30' }, { atividades: '' }, { atividades: 'A'.repeat(301) }, { comentarios: 'C'.repeat(301) }, { empresa: 'E'.repeat(61) }, { periodo: 'P'.repeat(36) }]) {
        assert.equal((await requisitar('/professor/aluno/1/fac', { method: 'POST', body: { ...form(), ...alteracao } })).status, 422);
    }
    assert.equal(await facs.buscarPorAluno(1), null);
    await db.exec('UPDATE alunos SET encerrado_em=NOW() WHERE usuario_id=1');
    const facEncerrada = await requisitar('/professor/aluno/1/fac', { user: 101 });
    assert.equal(facEncerrada.status, 200);
    assert.match(await facEncerrada.text(), /A ata da banca já foi emitida/);
    assert.equal((await requisitar('/professor/aluno/1/fac', { user: 101, method: 'POST', body: form() })).status, 403);
    // nem rascunho pode ser salvo depois da ata emitida
    assert.equal((await requisitar('/professor/aluno/1/fac', { user: 101, method: 'POST', body: { ...form(), acao: 'rascunho' } })).status, 403);
    await db.exec('UPDATE alunos SET encerrado_em=NULL, arquivado=true WHERE usuario_id=1');
    assert.equal((await requisitar('/professor/aluno/1/fac', { method: 'POST', body: form() })).status, 403);

    // notas aceitam até duas casas decimais
    await db.exec('UPDATE alunos SET arquivado=false WHERE usuario_id=1');
    assert.equal((await requisitar('/professor/aluno/1/fac', { method: 'POST', body: { ...form(), nota_0: '7.55' } })).status, 302);
    assert.equal((await facs.buscarPorAluno(1)).notas[0], 7.55);
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
test('vínculo Google: e-mail igual não assume conta já vinculada; trocar o e-mail libera novo vínculo', async () => {
    const usuarios = require('../src/models/usuarios');
    const googleDe = async (id) => (await consultar('SELECT google_id FROM usuarios WHERE id=$1', [id])).rows[0].google_id;

    assert.equal((await usuarios.vincularGoogleId(1, 'google-original', null)).google_id, 'google-original');
    assert.equal(await usuarios.vincularGoogleId(1, 'google-de-outra-pessoa', null), null);
    assert.equal(await googleDe(1), 'google-original');

    // corrigir só o nome (ou a caixa do e-mail) mantém o vínculo
    await usuarios.atualizarDadosAdmin(1, 'Estudante Corrigido', 'ALUNO1@example.test');
    assert.equal(await googleDe(1), 'google-original');
    // trocar o e-mail desfaz o vínculo antigo e permite vincular a conta nova
    await usuarios.atualizarDadosAdmin(1, 'Estudante Corrigido', 'novo.email@example.test');
    assert.equal(await googleDe(1), null);
    assert.equal((await usuarios.vincularGoogleId(1, 'google-novo', null)).google_id, 'google-novo');
});
test('perfil guarda as preferências de e-mail e o lembrete respeita a escolha do estudante', async () => {
    const cursos = require('../src/config/cursos').CURSOS;
    const prefs = async (id) => (await consultar('SELECT receber_email_bancas AS bancas, receber_lembretes_atividades AS lembretes FROM usuarios WHERE id=$1', [id])).rows[0];
    assert.deepEqual(await prefs(1), { bancas: true, lembretes: true });
    assert.match(await (await requisitar('/perfil', { user: 1 })).text(), /E-mails da plataforma/);

    // caixas desmarcadas não chegam no formulário: o estudante deixa de receber os dois
    const base = { nome: 'Estudante 1', matricula: 'TESTE1', curso: cursos[0] };
    await requisitar('/perfil', { user: 1, method: 'POST', body: base });
    assert.deepEqual(await prefs(1), { bancas: false, lembretes: false });
    await db.exec("UPDATE alunos SET relatorio_atualizado_em = NOW() WHERE usuario_id > 1");
    const enviadas = [];
    assert.deepEqual(await executar(emailTeste(enviadas)), { enviados: 0, falhas: 0 });

    await requisitar('/perfil', { user: 1, method: 'POST', body: { ...base, receber_lembretes_atividades: 'on' } });
    assert.deepEqual(await prefs(1), { bancas: false, lembretes: true });
    assert.equal((await executar(emailTeste(enviadas))).enviados, 1);

    // professor: escolhe só os avisos de banca; o lembrete de atividades não se aplica a ele
    await requisitar('/perfil', { user: 101, method: 'POST', body: { nome: 'Professor 101' } });
    assert.deepEqual(await prefs(101), { bancas: false, lembretes: true });
    await requisitar('/perfil', { user: 101, method: 'POST', body: { nome: 'Professor 101', receber_email_bancas: 'on' } });
    assert.deepEqual(await prefs(101), { bancas: true, lembretes: true });
});
test('acompanhamento: só o administrador vê; totais por curso, etapas, pendências e filtros', async () => {
    const info = 'Curso Técnico em Informática Integrado ao Ensino Médio';
    await db.exec(`UPDATE alunos SET relatorio_atualizado_em = NOW();
        UPDATE alunos SET status = 'lista_espera', orientador_id = NULL, supervisor_id = NULL WHERE usuario_id = 2;
        UPDATE alunos SET status = 'concluido', curso = '${info}', carga_horaria = 60 WHERE usuario_id IN (3, 4);
        UPDATE alunos SET encerrado_em = NOW() WHERE usuario_id = 4;
        UPDATE alunos SET arquivado = true WHERE usuario_id = 5;
        UPDATE alunos SET curso = NULL, supervisor_id = NULL, relatorio_atualizado_em = NOW() - INTERVAL '9 days' WHERE usuario_id = 6;
        INSERT INTO atividades (aluno_id, data, horas, descricao, status_validacao) VALUES
            (1, '2026-03-02', 4, 'Pendente de validação', 'pendente'), (3, '2026-03-03', 30, 'Validada', 'validada');
        UPDATE alunos SET relatorio_atualizado_em = NOW() WHERE usuario_id IN (1, 3);`);

    const comum = await requisitar('/professor/acompanhamento', { user: 102 });
    assert.equal(comum.status, 302);
    assert.equal(comum.headers.get('location'), '/professor/dashboard');

    const modelo = require('../src/models/acompanhamento');
    const todos = await modelo.listarEstudantes();
    const { geral, cursos } = modelo.resumir(todos);
    assert.equal(geral.total, 9); // o arquivado fica de fora
    assert.deepEqual(geral.etapas, { lista_espera: 1, em_andamento: 6, aguardando_banca: 1, encerrado: 1 });
    const porNome = Object.fromEntries(cursos.map((c) => [c.nome, c]));
    assert.equal(porNome['Informática'].total, 2);
    assert.equal(porNome['Informática'].progressoMedio, 25); // 50% e 0%
    assert.equal(porNome['Eletroeletrônica'].total, 0);
    assert.equal(porNome['Curso não informado'].total, 1);

    const pendencias = Object.fromEntries(todos.map((a) => [a.usuario_id, a.pendencias]));
    assert.deepEqual(pendencias[1], ['4h aguardando validação']);
    assert.deepEqual(pendencias[2], ['Aguardando aprovação do cadastro']);
    assert.deepEqual(pendencias[3], ['Banca não agendada']);
    assert.deepEqual(pendencias[4], []);
    assert.deepEqual(pendencias[6], ['Curso não informado', 'Sem supervisor', 'Sem registrar há 9 dias']);
    assert.deepEqual(pendencias[7], []);
    assert.equal(geral.comPendencias, 4);

    const pagina = await requisitar('/professor/acompanhamento', { user: 104 });
    assert.equal(pagina.status, 200);
    const html = await pagina.text();
    assert.match(html, /Acompanhamento dos estágios/);
    assert.match(html, /Estudante 6/); assert.doesNotMatch(html, /Estudante 5</);

    const filtrada = await (await requisitar('/professor/acompanhamento?etapa=aguardando_banca&curso=' + encodeURIComponent(info), { user: 104 })).text();
    assert.match(filtrada, /Estudante 3</); assert.doesNotMatch(filtrada, /Estudante 4</); assert.doesNotMatch(filtrada, /Estudante 1</);
    const soPendencias = await (await requisitar('/professor/acompanhamento?pendencias=1', { user: 104 })).text();
    assert.match(soPendencias, /Estudante 6</); assert.doesNotMatch(soPendencias, /Estudante 7</);
    const menuAdmin = await (await requisitar('/professor/dashboard', { user: 104 })).text();
    assert.doesNotMatch(menuAdmin, /href="\/professor\/acompanhamento" class="nav-link/);
    const painelAdmin = await (await requisitar('/professor/administracao', { user: 104 })).text();
    assert.match(painelAdmin, /href="\/professor\/acompanhamento" class="action-card"/);
    // o card de adicionar usuário é redundante com "Gerenciar usuários"
    assert.doesNotMatch(painelAdmin, /href="\/professor\/usuarios\/novo" class="action-card"/);
});
test('papéis acumuláveis: o administrador combina servidor, orientador, supervisor e administrador', async () => {
    const usuarios = require('../src/models/usuarios');
    const papeis = async (id) => (await consultar('SELECT cargo, papel_servidor AS servidor, papel_orientador AS orientador, papel_supervisor AS supervisor FROM professores WHERE usuario_id=$1', [id])).rows[0];
    const definir = (id, lista, user = 104) => requisitar(`/professor/usuarios/${id}/papeis`, { user, method: 'POST', body: { papeis: lista } });

    // por padrão, toda conta interna pode orientar e supervisionar
    assert.deepEqual(await papeis(103), { cargo: 'comum', servidor: false, orientador: true, supervisor: true });

    // conta cadastrada como servidor entra só com esse papel
    await requisitar('/professor/usuarios', { user: 104, method: 'POST', body: { nome: 'Servidora Nova', email: 'servidora@example.test', tipo: 'servidor' } });
    const nova = (await consultar("SELECT id FROM usuarios WHERE email='servidora@example.test'")).rows[0].id;
    assert.deepEqual(await papeis(nova), { cargo: 'comum', servidor: true, orientador: false, supervisor: false });

    // só o administrador define papéis, nunca os próprios, e ao menos um é obrigatório
    assert.equal((await definir(103, ['servidor'], 102)).headers.get('location'), '/professor/dashboard');
    await definir(104, ['orientador']);
    assert.equal((await papeis(104)).cargo, 'admin');
    await definir(103, []);
    assert.deepEqual(await papeis(103), { cargo: 'comum', servidor: false, orientador: true, supervisor: true });
    await definir(105, ['servidor']); // supervisor externo não acumula papéis
    assert.equal((await papeis(105)).cargo, 'supervisor');

    // papel com estudantes em aberto não pode ser retirado (102 orienta, 101 supervisiona)
    await definir(102, ['servidor', 'supervisor']);
    assert.equal((await papeis(102)).orientador, true);
    await definir(101, ['orientador']);
    assert.equal((await papeis(101)).supervisor, true);

    // 103 passa a ser só servidor: abre no acompanhamento e não tem a tela de alunos
    await definir(103, ['servidor']);
    assert.deepEqual(await papeis(103), { cargo: 'comum', servidor: true, orientador: false, supervisor: false });
    assert.equal((await requisitar('/professor/inicio', { user: 103 })).headers.get('location'), '/professor/acompanhamento');
    assert.equal((await requisitar('/professor/dashboard', { user: 103 })).headers.get('location'), '/professor/acompanhamento');
    const acompanhamento = await requisitar('/professor/acompanhamento', { user: 103 });
    assert.equal(acompanhamento.status, 200);
    const htmlServidor = await acompanhamento.text();
    assert.match(htmlServidor, /Estudante 1</); assert.match(htmlServidor, /Estudante 9</);
    assert.match(htmlServidor, /href="\/professor\/acompanhamento" class="nav-link/);
    assert.match(htmlServidor, /class="nav-user-dropdown"/);
    assert.match(htmlServidor, /href="\/perfil" class="nav-user-item"/);
    assert.match(htmlServidor, /href="\/logout" class="nav-user-item/);
    assert.doesNotMatch(htmlServidor, /href="\/professor\/dashboard" class="nav-link/);
    assert.doesNotMatch(htmlServidor, /href="\/professor\/administracao"/);
    assert.equal((await requisitar('/professor/aluno/1', { user: 103 })).status, 200);
    assert.equal((await requisitar('/professor/usuarios/novo', { user: 103 })).headers.get('location'), '/professor/dashboard');
    // busca por nome dentro do acompanhamento
    const busca = await (await requisitar('/professor/acompanhamento?q=' + encodeURIComponent('estudante 10'), { user: 103 })).text();
    assert.match(busca, /Estudante 10</); assert.doesNotMatch(busca, /Estudante 2</);

    // quem não é orientador nem supervisor não aparece nem é aceito nesses campos
    assert.equal((await usuarios.listarProfessores()).some((p) => p.id === 103), false);
    assert.equal((await usuarios.listarSupervisoresInternos()).some((p) => p.id === 103), false);
    const edicao = { empresa: 'Empresa Exemplo', carga_horaria: '60', status: 'em_andamento',
        dias_trabalho: ['1'], horario_inicio_1: '08:00', horario_fim_1: '12:00' };
    await requisitar('/professor/aluno/1', { user: 104, method: 'POST', body: { ...edicao, orientador_id: '103', supervisor_id: '101' } });
    await requisitar('/professor/aluno/1', { user: 104, method: 'POST', body: { ...edicao, orientador_id: '102', supervisor_id: '103' } });
    const responsaveis = (await consultar('SELECT orientador_id, supervisor_id FROM alunos WHERE usuario_id=1')).rows[0];
    assert.deepEqual([responsaveis.orientador_id, responsaveis.supervisor_id], [102, 101]);

    // servidor + orientador + administrador ao mesmo tempo
    await definir(103, ['admin', 'servidor', 'orientador']);
    assert.deepEqual(await papeis(103), { cargo: 'admin', servidor: true, orientador: true, supervisor: false });
    assert.equal((await usuarios.listarProfessores()).some((p) => p.id === 103), true);
    assert.equal((await requisitar('/professor/inicio', { user: 103 })).headers.get('location'), '/professor/acompanhamento');
    assert.equal((await requisitar('/professor/dashboard', { user: 103 })).status, 200);
    assert.equal((await requisitar('/professor/usuarios/novo', { user: 103 })).status, 200);
    // como também é administrador, o Acompanhamento sai do menu e passa a viver na Administração
    const painelAdminServidor = await (await requisitar('/professor/administracao', { user: 103 })).text();
    assert.doesNotMatch(painelAdminServidor, /href="\/professor\/acompanhamento" class="nav-link/);
    assert.match(painelAdminServidor, /href="\/professor\/acompanhamento" class="action-card"/);

    // professor comum: começa na tela de alunos e não acessa o acompanhamento
    assert.equal((await requisitar('/professor/inicio', { user: 101 })).headers.get('location'), '/professor/dashboard');
    assert.equal((await requisitar('/professor/acompanhamento', { user: 101 })).headers.get('location'), '/professor/dashboard');

    // a tela de usuários mostra os papéis e o editor
    const tela = await (await requisitar('/professor/usuarios?tipo=servidor', { user: 104 })).text();
    assert.match(tela, /Servidor \(setor de estágios\)/); assert.match(tela, /Editar dados e papéis/);
});
test('administração separada: página própria, cadastro com papéis e edição de dados dos usuários', async () => {
    const cursos = require('../src/config/cursos').CURSOS;
    const linha = async (sql, params) => (await consultar(sql, params)).rows[0];

    // página própria, só para administradores; a aba antiga redireciona
    assert.equal((await requisitar('/professor/administracao', { user: 104 })).status, 200);
    assert.equal((await requisitar('/professor/administracao', { user: 102 })).headers.get('location'), '/professor/dashboard');
    assert.equal((await requisitar('/professor/dashboard?aba=administracao', { user: 104 })).headers.get('location'), '/professor/administracao');
    const painel = await (await requisitar('/professor/dashboard', { user: 104 })).text();
    assert.doesNotMatch(painel, /class="tab /);
    // administração saiu da barra principal e vive no menu do perfil
    assert.doesNotMatch(painel, /href="\/professor\/administracao" class="nav-link/);
    assert.match(painel, /href="\/professor\/administracao" class="nav-user-item"/);

    // cadastro de conta interna com vários papéis de uma vez
    const novo = await (await requisitar('/professor/usuarios/novo', { user: 104 })).text();
    assert.match(novo, /Professor ou servidor/); assert.match(novo, /name="papeis" value="supervisor"/);
    assert.match(novo, /user-form-layout/); assert.match(novo, /Resumo da conta/);
    await requisitar('/professor/usuarios', { user: 104, method: 'POST', body: { nome: 'Paula Interna', email: 'Paula@Example.test', tipo: 'interno', papeis: ['servidor', 'supervisor', 'admin'] } });
    const paula = await linha("SELECT u.id, u.email, p.cargo, p.papel_servidor AS servidor, p.papel_orientador AS orientador, p.papel_supervisor AS supervisor FROM usuarios u JOIN professores p ON p.usuario_id=u.id WHERE LOWER(u.email)='paula@example.test'");
    assert.deepEqual([paula.email, paula.cargo, paula.servidor, paula.orientador, paula.supervisor], ['paula@example.test', 'admin', true, false, true]);
    // conta interna sem papel é recusada
    await requisitar('/professor/usuarios', { user: 104, method: 'POST', body: { nome: 'Sem Papel', email: 'sempapel@example.test', tipo: 'interno' } });
    assert.equal((await consultar("SELECT 1 FROM usuarios WHERE email='sempapel@example.test'")).rows.length, 0);

    // edição: só administrador; nome, e-mail e papéis de uma conta interna
    assert.equal((await requisitar(`/professor/usuarios/${paula.id}/editar`, { user: 102 })).headers.get('location'), '/professor/dashboard');
    const tela = await (await requisitar(`/professor/usuarios/${paula.id}/editar`, { user: 104 })).text();
    assert.match(tela, /value="Paula Interna"/); assert.match(tela, /Salvar alterações/);
    const editar = (id, body, user = 104) => requisitar(`/professor/usuarios/${id}`, { user, method: 'POST', body });
    assert.equal((await editar(paula.id, { nome: 'Paula Souza', email: 'paula.souza@example.test', papeis: ['orientador'] })).headers.get('location'), '/professor/usuarios');
    assert.deepEqual(await linha('SELECT u.nome, u.email, p.cargo, p.papel_servidor AS servidor, p.papel_orientador AS orientador, p.papel_supervisor AS supervisor FROM usuarios u JOIN professores p ON p.usuario_id=u.id WHERE u.id=$1', [paula.id]),
        { nome: 'Paula Souza', email: 'paula.souza@example.test', cargo: 'comum', servidor: false, orientador: true, supervisor: false });
    // e-mail de outra pessoa e conta sem papéis são recusados
    await editar(paula.id, { nome: 'Paula Souza', email: 'orientador@example.test', papeis: ['orientador'] });
    await editar(paula.id, { nome: 'Paula Souza', email: 'paula.souza@example.test' });
    assert.deepEqual(await linha('SELECT email, papel_orientador AS orientador FROM usuarios u JOIN professores p ON p.usuario_id=u.id WHERE u.id=$1', [paula.id]),
        { email: 'paula.souza@example.test', orientador: true });
    // papel com estudantes em aberto não sai pela edição (102 orienta)
    await editar(102, { nome: 'Orientador Teste', email: 'orientador@example.test', papeis: ['supervisor'] });
    assert.equal((await linha('SELECT papel_orientador AS orientador FROM professores WHERE usuario_id=102')).orientador, true);
    // o administrador edita os próprios dados, mas não os próprios papéis
    await editar(104, { nome: 'Admin Renomeado', email: 'admin@example.test', papeis: ['orientador'] });
    assert.deepEqual(await linha('SELECT u.nome, p.cargo FROM usuarios u JOIN professores p ON p.usuario_id=u.id WHERE u.id=104'), { nome: 'Admin Renomeado', cargo: 'admin' });

    // estudante: matrícula e curso; matrícula de outro estudante é recusada
    await editar(1, { nome: 'Estudante Um', email: 'aluno1@example.test', matricula: 'MAT-001', curso: cursos[2] });
    assert.deepEqual(await linha('SELECT u.nome, a.matricula, a.curso FROM usuarios u JOIN alunos a ON a.usuario_id=u.id WHERE u.id=1'), { nome: 'Estudante Um', matricula: 'MAT-001', curso: cursos[2] });
    await editar(2, { nome: 'Estudante 2', email: 'aluno2@example.test', matricula: 'MAT-001', curso: cursos[0] });
    assert.notEqual((await linha('SELECT matricula FROM alunos WHERE usuario_id=2')).matricula, 'MAT-001');

    // supervisor externo: empresa e função
    await editar(105, { nome: 'Supervisor Externo', email: 'externo@example.test', empresa: 'Nova Empresa', funcao: 'Gerente' });
    assert.deepEqual(await linha('SELECT cargo, empresa_externa, funcao_externa FROM professores WHERE usuario_id=105'), { cargo: 'supervisor', empresa_externa: 'Nova Empresa', funcao_externa: 'Gerente' });

    // quem é só administrador começa na administração e não tem a tela de alunos
    await requisitar('/professor/usuarios/103/papeis', { user: 104, method: 'POST', body: { papeis: ['admin'] } });
    assert.equal((await requisitar('/professor/inicio', { user: 103 })).headers.get('location'), '/professor/administracao');
    assert.equal((await requisitar('/professor/dashboard', { user: 103 })).headers.get('location'), '/professor/administracao');
    const menu = await (await requisitar('/professor/administracao', { user: 103 })).text();
    assert.doesNotMatch(menu, /href="\/professor\/dashboard" class="nav-link/);
    assert.doesNotMatch(menu, /href="\/professor\/fichas" class="nav-link/);
    assert.doesNotMatch(menu, /href="\/professor\/acompanhamento" class="nav-link/);
    assert.match(menu, /href="\/professor\/acompanhamento" class="action-card"/);
    // o menu do perfil reúne perfil, administração e sair
    assert.match(menu, /class="nav-user-dropdown"/);
    assert.match(menu, /href="\/professor\/administracao" class="nav-user-item"/);
    assert.match(menu, /href="\/logout" class="nav-user-item/);
    assert.equal((await requisitar('/professor/fichas', { user: 103 })).headers.get('location'), '/professor/inicio');
    const internos = await (await requisitar('/professor/usuarios?tipo=professor', { user: 104 })).text();
    assert.match(internos, /outro@example\.test/);
});
test('breadcrumbs seguem as seções do menu: administração não vira raiz de alunos e fichas', async () => {
    const trilha = async (rota, user) => {
        const html = await (await requisitar(rota, { user })).text();
        const nav = html.match(/<nav class="breadcrumb"[\s\S]*?<\/nav>/);
        assert.ok(nav, `sem breadcrumb em ${rota}`);
        return [...nav[0].matchAll(/<(?:a href="([^"]*)"|span aria-current="page")>([^<]*)</g)].map((m) => m[1] ? `${m[2]}→${m[1]}` : m[2]);
    };
    // administrador que também orienta (104 tem papéis padrão)
    assert.deepEqual(await trilha('/professor/dashboard', 104), ['Estagiários']);
    assert.deepEqual(await trilha('/professor/fichas', 104), ['Fichas']);
    assert.deepEqual(await trilha('/professor/bancas', 104), ['Agenda de bancas']);
    assert.deepEqual(await trilha('/perfil', 104), ['Início→/professor/inicio', 'Meu perfil']);
    assert.deepEqual(await trilha('/professor/administracao', 104), ['Administração']);
    assert.deepEqual(await trilha('/professor/usuarios', 104), ['Administração→/professor/administracao', 'Usuários']);
    // professor comum aprova cadastro voltando para a própria lista, não para o acompanhamento
    await db.exec("UPDATE alunos SET status='lista_espera', orientador_id=NULL, supervisor_id=NULL WHERE usuario_id=2");
    assert.deepEqual(await trilha('/professor/cadastro-aluno/2', 102), ['Estagiários→/professor/dashboard', 'Aprovar cadastro de Estudante 2']);
    assert.deepEqual(await trilha('/professor/aluno/1', 102), ['Estagiários→/professor/dashboard', 'Estudante 1']);
    // quem é só servidor chega aos estudantes pelo acompanhamento
    await requisitar('/professor/usuarios/103/papeis', { user: 104, method: 'POST', body: { papeis: ['servidor'] } });
    assert.deepEqual(await trilha('/professor/aluno/1', 103), ['Acompanhamento→/professor/acompanhamento', 'Estudante 1']);
    // estudante
    assert.deepEqual(await trilha('/aluno/dashboard?aba=fichas', 1), ['Início→/aluno/dashboard', 'Fichas']);
});
test('Editar estágio: sem campo de situação, só orientador e administrador, lista de espera vai para a aprovação', async () => {
    const edicao = { empresa: 'Empresa Nova', carga_horaria: '60', orientador_id: '102', supervisor_id: '101',
        dias_trabalho: ['1'], horario_inicio_1: '08:00', horario_fim_1: '12:00' };
    const empresa = async (id) => (await consultar('SELECT empresa, status FROM alunos WHERE usuario_id=$1', [id])).rows[0];

    // a tela não oferece mais a troca de situação
    const tela = await (await requisitar('/professor/aluno/1?aba=estagio', { user: 102 })).text();
    assert.match(tela, /id="panel-estagio"/);
    assert.doesNotMatch(tela, /name="status"/);

    // e o servidor ignora uma tentativa de devolver à lista de espera
    await requisitar('/professor/aluno/1', { user: 102, method: 'POST', body: { ...edicao, status: 'lista_espera' } });
    assert.deepEqual(await empresa(1), { empresa: 'Empresa Nova', status: 'em_andamento' });

    // supervisor e outro professor não editam; administrador edita
    assert.doesNotMatch(await (await requisitar('/professor/aluno/1', { user: 101 })).text(), /id="panel-estagio"/);
    await requisitar('/professor/aluno/1', { user: 101, method: 'POST', body: { ...edicao, empresa: 'Pelo supervisor' } });
    await requisitar('/professor/aluno/1', { user: 103, method: 'POST', body: { ...edicao, empresa: 'Por outro professor' } });
    assert.equal((await empresa(1)).empresa, 'Empresa Nova');
    await requisitar('/professor/aluno/1', { user: 104, method: 'POST', body: { ...edicao, empresa: 'Pelo administrador' } });
    assert.equal((await empresa(1)).empresa, 'Pelo administrador');

    // lista de espera: sem aba de edição, com o caminho para a aprovação, e o servidor encaminha para lá
    await db.exec("UPDATE alunos SET status='lista_espera' WHERE usuario_id=2");
    const espera = await (await requisitar('/professor/aluno/2', { user: 102 })).text();
    assert.doesNotMatch(espera, /id="panel-estagio"/);
    assert.match(espera, /href="\/professor\/cadastro-aluno\/2"/);
    const tentativa = await requisitar('/professor/aluno/2', { user: 102, method: 'POST', body: edicao });
    assert.equal(tentativa.headers.get('location'), '/professor/cadastro-aluno/2');
    assert.equal((await empresa(2)).status, 'lista_espera');
});
test('inclusão de estágios pelo setor: rascunho, retomada e conclusão para estudante existente ou novo', async () => {
    const cursos = require('../src/config/cursos').CURSOS;
    await requisitar('/professor/usuarios/103/papeis', { user: 104, method: 'POST', body: { papeis: ['servidor'] } });
    const servidor = (rota, opcoes = {}) => requisitar(rota, { user: 103, ...opcoes });

    // professor comum não acessa; servidor vê o item no menu
    assert.equal((await requisitar('/professor/estagios', { user: 101 })).headers.get('location'), '/professor/inicio');
    assert.match(await (await servidor('/professor/estagios')).text(), /href="\/professor\/estagios" class="nav-link/);

    // estudante 2 na lista de espera aparece para seleção
    await db.exec("UPDATE alunos SET status='lista_espera', orientador_id=NULL, supervisor_id=NULL, empresa=NULL WHERE usuario_id=2");
    assert.match(await (await servidor('/professor/estagios/novo')).text(), /<option value="2"[^>]*>Estudante 2/);

    // salvar rascunho no meio do caminho, sem os horários
    const parcial = { modo: 'existente', aluno_id: '2', orientador_id: '102', supervisor_id: '', empresa: 'Empresa do Setor', carga_horaria: '80', passo: '3' };
    assert.equal((await servidor('/professor/estagios/rascunho', { method: 'POST', body: parcial })).headers.get('location'), '/professor/estagios');
    const rascunho = (await consultar('SELECT id, dados, atualizado_por FROM estagios_rascunhos')).rows[0];
    assert.equal(rascunho.dados.empresa, 'Empresa do Setor'); assert.equal(rascunho.atualizado_por, 103);
    const lista = await (await servidor('/professor/estagios')).text();
    assert.match(lista, /Estudante 2/); assert.match(lista, /Parou em: Horários/);
    assert.equal((await consultar('SELECT status FROM alunos WHERE usuario_id=2')).rows[0].status, 'lista_espera');

    // outra pessoa do setor (o administrador) continua o rascunho com os dados preenchidos
    const retomada = await (await requisitar(`/professor/estagios/novo?rascunho=${rascunho.id}`, { user: 104 })).text();
    assert.match(retomada, /value="Empresa do Setor"/); assert.match(retomada, /data-wizard-inicio="3"/);

    // concluir com horário inválido volta para a tela com os dados e não altera nada
    const horarioRuim = { ...parcial, rascunho_id: String(rascunho.id), dias_trabalho: ['1'], horario_inicio_1: '08:00', horario_fim_1: '15:00' };
    const erro = await servidor('/professor/estagios', { method: 'POST', body: horarioRuim });
    assert.equal(erro.status, 422);
    const erroHtml = await erro.text();
    assert.match(erroHtml, /6 horas/); assert.match(erroHtml, /value="Empresa do Setor"/);
    assert.equal((await consultar('SELECT status FROM alunos WHERE usuario_id=2')).rows[0].status, 'lista_espera');

    // concluir: estágio em andamento e rascunho apagado
    const ok = await servidor('/professor/estagios', { method: 'POST', body: { ...horarioRuim, horario_fim_1: '12:00', supervisor_id: '101' } });
    assert.equal(ok.headers.get('location'), '/professor/aluno/2');
    const aluno2 = (await consultar('SELECT status, empresa, orientador_id, supervisor_id, carga_horaria FROM alunos WHERE usuario_id=2')).rows[0];
    assert.deepEqual([aluno2.status, aluno2.empresa, aluno2.orientador_id, aluno2.supervisor_id, Number(aluno2.carga_horaria)], ['em_andamento', 'Empresa do Setor', 102, 101, 80]);
    assert.equal((await consultar('SELECT COUNT(*)::int AS n FROM estagios_rascunhos')).rows[0].n, 0);

    // estudante novo: cria a conta e o estágio de uma vez; e-mail repetido é recusado
    const novo = { modo: 'novo', nome: 'Nova Estagiária', email: 'Nova@Example.test', curso: cursos[1], orientador_id: '102',
        empresa: 'Empresa Nova', carga_horaria: '60', dias_trabalho: ['2'], horario_inicio_2: '13:00', horario_fim_2: '17:00' };
    const criado = await servidor('/professor/estagios', { method: 'POST', body: novo });
    const nova = (await consultar("SELECT u.id, u.tipo, a.status, a.curso FROM usuarios u JOIN alunos a ON a.usuario_id=u.id WHERE u.email='nova@example.test'")).rows[0];
    assert.equal(criado.headers.get('location'), `/professor/aluno/${nova.id}`);
    assert.deepEqual([nova.tipo, nova.status, nova.curso], ['aluno', 'em_andamento', cursos[1]]);
    assert.equal((await servidor('/professor/estagios', { method: 'POST', body: novo })).status, 422);

    // estudante já com estágio não pode ser incluído de novo
    const repetido = await servidor('/professor/estagios', { method: 'POST', body: { ...novo, modo: 'existente', aluno_id: '2' } });
    assert.equal(repetido.status, 422);
    assert.match(await repetido.text(), /já tem o estágio definido/);
});
test('inclusão de estágio: dias e horários de trabalho são opcionais', async () => {
    await requisitar('/professor/usuarios/103/papeis', { user: 104, method: 'POST', body: { papeis: ['servidor'] } });
    await db.exec("UPDATE alunos SET status='lista_espera', orientador_id=NULL, supervisor_id=NULL WHERE usuario_id=2");
    const tela = await (await requisitar('/professor/estagios/novo', { user: 103 })).text();
    assert.match(tela, /data-horarios-opcionais/); assert.match(tela, /\(opcional\)<\/span><\/legend>/);

    const base = { modo: 'existente', aluno_id: '2', orientador_id: '102', empresa: 'Empresa Sem Horário', carga_horaria: '60' };
    const ok = await requisitar('/professor/estagios', { user: 103, method: 'POST', body: base });
    assert.equal(ok.headers.get('location'), '/professor/aluno/2');
    const aluno = (await consultar('SELECT status, horario_trabalho FROM alunos WHERE usuario_id=2')).rows[0];
    assert.deepEqual([aluno.status, aluno.horario_trabalho], ['em_andamento', {}]);

    // um dia marcado continua sendo validado
    await db.exec("UPDATE alunos SET status='lista_espera' WHERE usuario_id=3");
    const ruim = await requisitar('/professor/estagios', { user: 103, method: 'POST', body: { ...base, aluno_id: '3', dias_trabalho: ['1'], horario_inicio_1: '08:00', horario_fim_1: '15:00' } });
    assert.equal(ruim.status, 422);
});
test('Editar estágio: dias e horários de trabalho são opcionais', async () => {
    const tela = await (await requisitar('/professor/aluno/1?aba=estagio', { user: 102 })).text();
    assert.match(tela, /\(opcional\)<\/span><\/legend>/);
    const base = { empresa: 'Empresa Sem Quadro', carga_horaria: '60', orientador_id: '102', supervisor_id: '101' };
    await requisitar('/professor/aluno/1', { user: 102, method: 'POST', body: base });
    const aluno = (await consultar('SELECT empresa, horario_trabalho FROM alunos WHERE usuario_id=1')).rows[0];
    assert.deepEqual([aluno.empresa, aluno.horario_trabalho], ['Empresa Sem Quadro', {}]);
    // dia marcado continua validado
    await requisitar('/professor/aluno/1', { user: 102, method: 'POST', body: { ...base, empresa: 'Outra', dias_trabalho: ['1'], horario_inicio_1: '08:00', horario_fim_1: '15:00' } });
    assert.equal((await consultar('SELECT empresa FROM alunos WHERE usuario_id=1')).rows[0].empresa, 'Empresa Sem Quadro');
});
test('aprovação de cadastro: dias e horários de trabalho são opcionais', async () => {
    await db.exec("UPDATE alunos SET status='lista_espera', orientador_id=NULL, supervisor_id=NULL WHERE usuario_id=2");
    const tela = await (await requisitar('/professor/cadastro-aluno/2', { user: 102 })).text();
    assert.match(tela, /data-horarios-opcionais/); assert.match(tela, /\(opcional\)<\/span><\/legend>/);
    const ok = await requisitar('/professor/cadastro-aluno/2', { user: 102, method: 'POST', body: { empresa: 'Empresa Exemplo', carga_horaria: '60', orientador_id: '102' } });
    assert.equal(ok.headers.get('location'), '/professor/dashboard');
    const aluno = (await consultar('SELECT status, horario_trabalho FROM alunos WHERE usuario_id=2')).rows[0];
    assert.deepEqual([aluno.status, aluno.horario_trabalho], ['em_andamento', {}]);
});
test('acompanhamento: lista de estudantes com ordenação, paginação e roscas por curso', async () => {
    // 20 estudantes a mais para passar de uma página (15 por página)
    await db.exec(`INSERT INTO usuarios (id,nome,email,tipo,nome_confirmado)
        SELECT n, 'Extra ' || LPAD(n::text, 3, '0'), 'extra' || n || '@example.test', 'aluno', true FROM generate_series(301,320) n;
        INSERT INTO alunos (usuario_id,status,curso) SELECT n,'lista_espera','Curso Técnico em Informática Integrado ao Ensino Médio' FROM generate_series(301,320) n;`);
    const nomes = (html) => [...html.matchAll(/<a href="\/professor\/(?:aluno|cadastro-aluno)\/\d+"><strong>([^<]+)<\/strong>/g)].map((m) => m[1]);
    const pagina = async (query) => (await requisitar('/professor/acompanhamento' + query, { user: 104 })).text();

    const p1 = await pagina('');
    assert.equal(nomes(p1).length, 15);
    assert.match(p1, /Mostrando 1–15 de 30/);
    assert.match(p1, /aria-sort="ascending"/);
    const p2 = await pagina('?pagina=2');
    assert.equal(nomes(p2).length, 15);
    assert.match(p2, /Mostrando 16–30 de 30/);
    assert.deepEqual([...nomes(p1), ...nomes(p2)], [...nomes(p1), ...nomes(p2)].slice().sort((a, b) => a.localeCompare(b, 'pt-BR')));
    // página além do fim cai na última; filtro mantém a ordenação e volta para a página 1
    assert.match(await pagina('?pagina=99'), /Mostrando 16–30 de 30/);
    const desc = await pagina('?ordenar=nome&dir=desc');
    assert.equal(nomes(desc)[0], 'Extra 320');
    const filtrado = await pagina('?ordenar=nome&dir=desc&etapa=lista_espera');
    assert.match(filtrado, /Mostrando 1–15 de 20/);
    assert.match(filtrado, /href="\/professor\/acompanhamento\?etapa=lista_espera&amp;dir=desc&amp;pagina=2#estudantes"/);
    // por etapa: lista de espera vem antes de em andamento
    const porEtapa = nomes(await pagina('?ordenar=etapa'));
    assert.ok(porEtapa[0].startsWith('Extra'));

    // uma rosca por curso, com o total no centro
    assert.match(p1, /aria-label="Informática: Lista de espera: 20, Em andamento: 0/);
    assert.match(p1, /class="acomp-rosca-total">20</);
});
