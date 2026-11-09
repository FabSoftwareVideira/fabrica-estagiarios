const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
        req.session = { user: { id, nome: id === 101 ? 'Supervisor Teste' : 'Usuário Teste', tipo: id === 1 ? 'aluno' : 'professor', cargo: 'comum' } };
        next();
    });
    app.use(require('../src/middleware/auth').attachUser);
    app.use('/professor', require('../src/routes/professor'));
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
        (103,'Outro Professor','outro@example.test','professor',true);
        INSERT INTO professores (usuario_id) VALUES (101),(102),(103);
        INSERT INTO usuarios (id,nome,email,tipo,nome_confirmado)
        SELECT n, 'Estudante ' || n, 'aluno' || n || '@example.test', 'aluno', true FROM generate_series(1,10) n
        ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, email=EXCLUDED.email, tipo='aluno';
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

async function requisitar(rota, { user = 101, body, method = 'GET' } = {}) {
    return fetch(url + rota, { method, redirect: 'manual', headers: { 'x-test-user': String(user), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: body ? new URLSearchParams(body) : undefined });
}
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
