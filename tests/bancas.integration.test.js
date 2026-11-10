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
    // só o orientador marca a banca: administrador que não orienta recebe 403
    assert.equal((await http('/professor/aluno/201/banca', { user: 106, body: dados() })).status, 403);
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
test('agendar, remarcar, trocar avaliador e cancelar avisam por e-mail com convite de calendário', async () => {
    const { usarConfiguracaoEmail } = require('../src/services/conviteBanca');
    const enviados = [];
    usarConfiguracaoEmail(() => ({ remetente: 'Estágios <estagios@example.test>', enderecoRemetente: 'estagios@example.test',
        urlAplicacao: 'https://estagios.example.test', transporte: { async sendMail(mail) { enviados.push(mail); return { rejected: [] }; } } }));
    try {
        assert.equal((await http('/professor/aluno/201/banca', { body: dados({ observacoes: 'Trazer; relatório, impresso' }) })).status, 302);
        assert.equal(enviados.length, 1);
        const convite = enviados[0];
        assert.match(convite.subject, /agendada · Ana Teste/);
        assert.deepEqual(convite.to.map((p) => p.address).sort(), ['101@example.test', '102@example.test', '103@example.test', 'ana@example.test']);
        assert.equal(convite.icalEvent.method, 'REQUEST');
        const ics = convite.icalEvent.content.replace(/\r\n /g, '');
        assert.match(ics, /UID:banca-201@estagios\.example\.test/);
        assert.match(ics, /SEQUENCE:1\r\n/);
        assert.match(ics, new RegExp(`DTSTART:${amanha.replace(/-/g, '')}T170000Z`)); // 14:00 em Brasília
        assert.match(ics, /LOCATION:Sala 12/);
        assert.ok(ics.includes('Trazer\\; relatório\\, impresso'));
        assert.match(ics, /ATTENDEE;CN=Professor 102;[^\r]*:mailto:102@example\.test/);
        assert.ok(convite.icalEvent.content.split('\r\n').every((linha) => Buffer.byteLength(linha) <= 75));

        // salvar sem mudar nada não reenvia
        assert.equal((await http('/professor/aluno/201/banca', { body: dados({ versao: '1', observacoes: 'Trazer; relatório, impresso' }) })).status, 302);
        assert.equal(enviados.length, 1);

        // remarcar trocando um avaliador: convite novo para a banca atual e cancelamento para quem saiu
        assert.equal((await http('/professor/aluno/201/banca', { body: dados({ versao: '2', hora_inicio: '16:00', hora_fim: '17:00', avaliador_2_id: '105' }) })).status, 302);
        assert.equal(enviados.length, 3);
        assert.match(enviados[1].subject, /remarcada/);
        assert.ok(enviados[1].to.some((p) => p.address === '105@example.test'));
        assert.ok(!enviados[1].to.some((p) => p.address === '103@example.test'));
        assert.match(enviados[1].icalEvent.content, /SEQUENCE:3\r\n/);
        assert.deepEqual(enviados[2].to.map((p) => p.address), ['103@example.test']);
        assert.equal(enviados[2].icalEvent.method, 'CANCEL');

        assert.equal((await http('/professor/aluno/201/banca/situacao', { body: { versao: '3', situacao: 'cancelada' } })).status, 302);
        assert.equal(enviados.length, 4);
        assert.equal(enviados[3].icalEvent.method, 'CANCEL');
        assert.match(enviados[3].icalEvent.content, /STATUS:CANCELLED/);

        // falha no e-mail não impede o agendamento
        usarConfiguracaoEmail(() => { throw new Error('SMTP fora do ar'); });
        assert.equal((await http('/professor/aluno/202/banca', { user: 104, body: dados({ avaliador_1_id: '105', avaliador_2_id: '106', sala: 'Sala 20' }) })).status, 302);
        assert.equal((await bancas.buscarPorAluno(202)).situacao, 'agendada');
    } finally { usarConfiguracaoEmail(null); }
});
test('painel e agenda destacam as bancas em que o professor participa', async () => {
    await bancas.salvar(201, orientador, dados());
    await bancas.salvar(202, { id: 104 }, dados({ avaliador_1_id: '105', avaliador_2_id: '106', sala: 'Sala 20' }));
    assert.deepEqual((await bancas.listarProximasDoProfessor(102)).map((b) => b.aluno_id), [201]);
    assert.deepEqual((await bancas.listarProximasDoProfessor(999)), []);

    const painelAvaliador = await (await http('/professor/dashboard', { user: 102 })).text();
    assert.match(painelAvaliador, /Próxima banca:/); assert.match(painelAvaliador, /avaliador 1 · Sala 12/);
    // o painel não repete o atalho filtrado da agenda: ela é item do menu
    assert.doesNotMatch(painelAvaliador, /href="\/professor\/bancas\?/);
    assert.doesNotMatch(painelAvaliador, /Sala 20/);
    assert.doesNotMatch(await (await http('/professor/dashboard', { user: 103 })).text(), /Sala 20/);

    const todas = await (await http('/professor/bancas', { user: 102 })).text();
    assert.match(todas, /Sala 12/); assert.match(todas, /Sala 20/); assert.match(todas, /Você é avaliador 1/);
    const minhas = await (await http('/professor/bancas?minhas=1', { user: 102 })).text();
    assert.match(minhas, /Sala 12/); assert.doesNotMatch(minhas, /Sala 20/);
});
test('quem desativou os avisos de banca no perfil não recebe e-mail nem entra no convite', async () => {
    const { usarConfiguracaoEmail } = require('../src/services/conviteBanca');
    const enviados = [];
    usarConfiguracaoEmail(() => ({ remetente: 'estagios@example.test', enderecoRemetente: 'estagios@example.test',
        urlAplicacao: 'https://estagios.example.test', transporte: { async sendMail(mail) { enviados.push(mail); return { rejected: [] }; } } }));
    try {
        await db.exec('UPDATE usuarios SET receber_email_bancas = false WHERE id IN (102, 201)');
        assert.equal((await http('/professor/aluno/201/banca', { body: dados() })).status, 302);
        assert.deepEqual(enviados[0].to.map((p) => p.address).sort(), ['101@example.test', '103@example.test']);
        assert.doesNotMatch(enviados[0].icalEvent.content, /102@example\.test|ana@example\.test/);
        // a banca continua aparecendo no painel de quem desativou o e-mail
        assert.match(await (await http('/professor/dashboard', { user: 102 })).text(), /Próxima banca:/);

        // ninguém quer receber: nada é enviado e o agendamento segue normalmente
        await db.exec('UPDATE usuarios SET receber_email_bancas = false');
        assert.equal((await http('/professor/aluno/201/banca/situacao', { body: { versao: '1', situacao: 'cancelada' } })).status, 302);
        assert.equal(enviados.length, 1);
    } finally { usarConfiguracaoEmail(null); }
});
test('só o orientador marca a banca; o supervisor pode ser convidado sem ser avaliador', async () => {
    const { usarConfiguracaoEmail } = require('../src/services/conviteBanca');
    const enviados = [];
    usarConfiguracaoEmail(() => ({ remetente: 'estagios@example.test', enderecoRemetente: 'estagios@example.test',
        urlAplicacao: 'https://estagios.example.test', transporte: { async sendMail(mail) { enviados.push(mail); return { rejected: [] }; } } }));
    try {
        // administrador que não é o orientador só consulta
        assert.equal((await http('/professor/aluno/202/banca', { user: 106, body: dados({ avaliador_1_id: '105', avaliador_2_id: '101' }) })).status, 403);
        assert.doesNotMatch(await (await http('/professor/aluno/202/banca', { user: 106 })).text(), /Confirmar agendamento/);
        assert.equal(await bancas.buscarPorAluno(202), null);

        // orientador (104) convida o supervisor do estagiário (102), que não está entre os avaliadores
        const form = await (await http('/professor/aluno/202/banca', { user: 104 })).text();
        assert.match(form, /Convidar o supervisor \(Professor 102\)/);
        assert.equal((await http('/professor/aluno/202/banca', { user: 104, body: dados({ avaliador_1_id: '105', avaliador_2_id: '101', convidar_supervisor: 'on' }) })).status, 302);
        const banca = await bancas.buscarPorAluno(202);
        assert.equal(banca.convidar_supervisor, true);
        const convite = enviados[0];
        assert.ok(convite.to.some((p) => p.address === '102@example.test'));
        assert.match(convite.icalEvent.content.replace(/\r\n /g, ''), /ATTENDEE;CN=Professor 102;ROLE=OPT-PARTICIPANT/);
        assert.match(convite.text, /Supervisor \(convidado\): Professor 102/);
        assert.match(await (await http('/professor/bancas', { user: 104 })).text(), /Supervisor \(convidado\)/);

        // retirar o convite manda o cancelamento só para o supervisor
        assert.equal((await http('/professor/aluno/202/banca', { user: 104, body: dados({ avaliador_1_id: '105', avaliador_2_id: '101', versao: '1' }) })).status, 302);
        assert.equal((await bancas.buscarPorAluno(202)).convidar_supervisor, false);
        assert.deepEqual(enviados[2].to.map((p) => p.address), ['102@example.test']);
        assert.equal(enviados[2].icalEvent.method, 'CANCEL');

        // a agenda é item do menu de quem orienta
        assert.match(await (await http('/professor/dashboard', { user: 104 })).text(), /href="\/professor\/bancas" class="nav-link/);
    } finally { usarConfiguracaoEmail(null); }
});
