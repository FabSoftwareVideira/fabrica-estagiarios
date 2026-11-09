const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { pool } = require('../src/config/database');
const bancas = require('../src/models/bancas');
const { lerAgendamento, celulaCsv, agoraBrasilia } = require('../src/utils/bancas');
let db, server, url;
const orientador = { id: 101, cargo: 'comum' };
const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const dados = (overrides = {}) => ({ avaliador_1_id: '102', avaliador_2_id: '103', data: amanha,
    hora_inicio: '14:00', hora_fim: '15:00', sala: 'Sala 12', link_reuniao: '', observacoes: '', versao: '0', ...overrides });
async function query(sql, params) { const r = await db.query(sql, params); return { ...r, rowCount: r.affectedRows ?? r.rows.length }; }
before(async () => {
    db = new PGlite();
    await db.exec(fs.readFileSync(path.join(__dirname, '../db/init.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/018_agendamento_bancas.sql'), 'utf8'));
    pool.query = query;
    let fila = Promise.resolve();
    pool.connect = async () => {
        const anterior = fila; let liberar; fila = new Promise((r) => { liberar = r; }); await anterior;
        return { query, release: liberar };
    };
    const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../src/views'));
    app.locals.icone = require('../src/utils/icones').icone;
    app.locals.dataBr = require('../src/utils/datas').formatarDataBr;
    app.locals.dataIso = require('../src/utils/datas').dataParaInput;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
        const id = Number(req.headers['x-test-user'] || 101);
        req.session = { user: { id, nome: 'Pessoa Teste', tipo: id >= 200 ? 'aluno' : 'professor', cargo: id === 106 ? 'admin' : 'comum' } }; next();
    });
    app.use(require('../src/middleware/auth').attachUser);
    app.use('/professor', require('../src/routes/professor'));
    app.use('/aluno', require('../src/routes/aluno'));
    server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
    await db.exec(`TRUNCATE usuarios CASCADE;
        INSERT INTO usuarios (id,nome,email,tipo,nome_confirmado)
        SELECT n, 'Professor ' || n, n || '@example.test','professor',true FROM generate_series(101,106) n;
        INSERT INTO professores (usuario_id,cargo)
        SELECT n, CASE WHEN n=106 THEN 'admin' ELSE 'comum' END FROM generate_series(101,106) n;
        INSERT INTO usuarios (id,nome,email,tipo,nome_confirmado) VALUES
        (201,'Ana Teste','ana@example.test','aluno',true),(202,'Bruno Teste','bruno@example.test','aluno',true);
        INSERT INTO alunos (usuario_id,supervisor_id,orientador_id,status) VALUES (201,102,101,'concluido'),(202,102,104,'concluido');`);
});
after(async () => { await new Promise((r) => server.close(r)); await db.close(); await pool.end(); });
async function http(rota, { user = 101, body } = {}) {
    return fetch(url + rota, { method: body ? 'POST' : 'GET', redirect: 'manual',
        headers: { 'x-test-user': String(user), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        body: body ? new URLSearchParams(body) : undefined });
}
test('agenda salva, exibe ao estudante, exporta e preenche nomes/data da ata', async () => {
    assert.equal((await http('/professor/aluno/201/banca', { body: dados() })).status, 302);
    const banca = await bancas.buscarPorAluno(201); assert.equal(banca.situacao, 'agendada'); assert.equal(banca.versao, 1);
    for (const [rota, user] of [['/professor/bancas', 101], ['/professor/aluno/201/banca', 101], ['/aluno/dashboard', 201]]) {
        const r = await http(rota, { user }); assert.equal(r.status, 200, rota); assert.match(await r.text(), /Sala 12/);
    }
    const outro = await http('/aluno/dashboard', { user: 202 }); assert.doesNotMatch(await outro.text(), /Sala 12/);
    const csv = await http('/professor/bancas/exportar.csv'); assert.equal(csv.status, 200);
    assert.match(await csv.text(), /"Ana Teste".*"Professor 101".*"Professor 102".*"Professor 103"/);
    const ata = await http('/professor/aluno/201/fare'); const html = await ata.text();
    assert.match(html, /value="Professor 102"/); assert.match(html, new RegExp(`value="${amanha}"`));
});
test('horários sobrepostos bloqueiam sala normalizada e participantes, horários adjacentes são permitidos', async () => {
    await bancas.salvar(201, orientador, dados());
    await assert.rejects(bancas.salvar(202, { id: 104 }, dados({ avaliador_1_id: '105', avaliador_2_id: '106', sala: '  SALA   12  ' })), /Conflito/);
    await assert.rejects(bancas.salvar(202, { id: 104 }, dados({ sala: 'Sala 15', hora_inicio: '14:30', hora_fim: '15:30' })), /Conflito/);
    const r = await bancas.salvar(202, { id: 104 }, dados({ hora_inicio: '15:00', hora_fim: '16:00' }));
    assert.equal(r.situacao, 'agendada');
});
test('duas tentativas de reserva deixam somente uma banca no horário conflitante', async () => {
    const r = await Promise.allSettled([bancas.salvar(201, orientador, dados()), bancas.salvar(202, { id: 104 }, dados())]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(r.filter((x) => x.status === 'rejected').length, 1);
});
test('remarcação atualiza agenda; versão antiga é recusada e cancelamento libera o horário', async () => {
    await bancas.salvar(201, orientador, dados());
    await bancas.salvar(201, orientador, dados({ versao: '1', hora_inicio: '16:00', hora_fim: '17:00' }));
    assert.equal((await bancas.buscarPorAluno(201)).situacao, 'remarcada');
    await assert.rejects(bancas.salvar(201, orientador, dados({ versao: '1' })), /outra pessoa/);
    await bancas.definirSituacao(201, orientador, 2, 'cancelada');
    assert.equal((await bancas.buscarPorAluno(201)).situacao, 'cancelada');
    assert.equal((await bancas.salvar(202, { id: 104 }, dados({ hora_inicio: '16:00', hora_fim: '17:00' }))).situacao, 'agendada');
});
test('somente orientador/admin alteram; horas pendentes, encerramento, repetição de pessoas e IDs inválidos são recusados', async () => {
    assert.equal((await http('/professor/aluno/201/banca', { user: 102, body: dados() })).status, 403);
    assert.equal((await http('/professor/aluno/201/banca', { user: 201, body: dados() })).status, 302);
    await assert.rejects(bancas.salvar(201, orientador, dados({ avaliador_1_id: '101' })), /pessoas diferentes/);
    await assert.rejects(bancas.salvar(201, orientador, dados({ avaliador_1_id: '201' })), /cadastrados/);
    await db.exec("UPDATE alunos SET status='em_andamento' WHERE usuario_id=201");
    await assert.rejects(bancas.salvar(201, orientador, dados()), /horas cumpridas/);
    await db.exec("UPDATE alunos SET status='concluido',encerrado_em=NOW() WHERE usuario_id=201");
    await assert.rejects(bancas.salvar(201, orientador, dados()), /estágio aberto/);
    await db.exec('UPDATE alunos SET encerrado_em=NULL WHERE usuario_id=201');
    assert.equal((await http('/professor/aluno/201/banca', { user: 106, body: dados() })).status, 302);
});
test('validação rejeita passado, horários inválidos, link inseguro e mantém os valores em conflito', async () => {
    for (const extra of [{ data: '2026-02-30' }, { data: '2000-01-01' }, { hora_inicio: '25:00' }, { hora_fim: '13:00' }, { avaliador_2_id: '102' }, { link_reuniao: 'javascript:alert(1)' }]) {
        assert.ok(lerAgendamento(dados(extra)).erros.length);
    }
    await bancas.salvar(201, orientador, dados());
    const r = await http('/professor/aluno/202/banca', { user: 104, body: dados() });
    assert.equal(r.status, 409); const html = await r.text(); assert.match(html, /Conflito de horário/); assert.match(html, /value="Sala 12"/);
    assert.equal((await http('/professor/bancas?inicio=invalido')).status, 400);
    assert.equal(agoraBrasilia(new Date('2026-11-09T01:30:00Z')).data, '2026-11-08');
    assert.equal(celulaCsv('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
});
test('realização só após término; marcar realizada não encerra o estágio e impede remarcação', async () => {
    await bancas.salvar(201, orientador, dados());
    await assert.rejects(bancas.definirSituacao(201, orientador, 1, 'realizada'), /após o horário/);
    await db.exec("UPDATE bancas SET data='2000-01-01' WHERE aluno_id=201");
    await bancas.definirSituacao(201, orientador, 1, 'realizada');
    assert.equal((await bancas.buscarPorAluno(201)).situacao, 'realizada');
    assert.equal((await query('SELECT encerrado_em FROM alunos WHERE usuario_id=201')).rows[0].encerrado_em, null);
    await assert.rejects(bancas.salvar(201, orientador, dados({ versao: '2' })), /realizadas/);
});
