// Job do relatório semanal: dia/horário configurados, uma mensagem por semana
// e as horas de cada estagiário. O relógio é fixado numa quarta-feira, 15h
// em Brasília (semana iniciada na segunda, 09/11/2026).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { criarBanco, ligarPool, SEMENTE, PESSOAS } = require('./helpers/ambiente');
const { pool } = require('../src/config/database');

let db;
let enviados;
// o job lê a configuração de e-mail ao ser carregado: troca antes do require
require('../src/services/email').obterConfiguracaoEmail = () => ({
    urlAplicacao: 'https://estagios.example.test', remetente: 'estagios@example.test', enderecoRemetente: 'estagios@example.test',
    transporte: { async sendMail(mensagem) { enviados.push(mensagem); } },
});
const { executar, montarEmail } = require('../src/scripts/enviarRelatorioSemanalSupervisores');

const AGORA = new Date('2026-11-11T18:00:00Z');
const configurar = (habilitado, dia, horario, ultimo = null) => db.query(
    'UPDATE configuracoes_relatorio_semanal SET habilitado = $1, dia_semana = $2, horario = $3, ultimo_envio_semana = $4 WHERE id = 1',
    [habilitado, dia, horario, ultimo]);
const quieto = { log() {}, error() {} };

before(async () => { db = await criarBanco(); ligarPool(db); });
beforeEach(async (t) => {
    await db.exec(SEMENTE);
    await db.query(`INSERT INTO atividades (aluno_id, data, horas, descricao, status_validacao) VALUES
        (${PESSOAS.ana}, '2026-11-10', 2, 'Na semana', 'pendente'),
        (${PESSOAS.ana}, '2026-11-11', 1, 'Invalidada', 'invalidada'),
        (${PESSOAS.ana}, '2026-11-01', 3, 'Semana anterior', 'validada')`);
    enviados = [];
    t.mock.timers.enable({ apis: ['Date'], now: AGORA });
    t.mock.method(console, 'log', quieto.log);
});
after(async () => { await db.close(); await pool.end(); });

test('desabilitado não envia', async () => {
    assert.deepEqual(await executar(), { enviado: false, motivo: 'desabilitado' });
    assert.equal(enviados.length, 0);
});

test('antes do dia ou do horário programado não envia', async () => {
    await configurar(true, 4, '08:00');
    assert.equal(await executar(), undefined);
    await configurar(true, 3, '15:15');
    assert.equal(await executar(), undefined);
    // domingo é o último dia da semana: uma programação para domingo ainda não chegou
    await configurar(true, 0, '00:00');
    assert.equal(await executar(), undefined);
    assert.equal(enviados.length, 0);
});

test('no horário envia uma mensagem com cópia oculta e registra a semana', async () => {
    await configurar(true, 3, '15:00');
    assert.deepEqual(await executar(), { enviado: true, destinatarios: 1, estudantes: 1 });
    assert.equal(enviados.length, 1);
    const [mensagem] = enviados;
    assert.equal(mensagem.to, 'estagios@example.test');
    assert.deepEqual(mensagem.bcc, ['supervisor@ifc.edu.br']);
    assert.match(mensagem.text, /Ana Andrade: 2\.00 horas na semana; 5\.00 de 100\.00 horas registradas no estágio; 3\.00 horas validadas/);
    assert.match(mensagem.text, /para avaliar: 1 pendente\(s\), 2\.00 horas/);

    const { rows: [config] } = await db.query("SELECT TO_CHAR(ultimo_envio_semana, 'YYYY-MM-DD') AS semana FROM configuracoes_relatorio_semanal");
    assert.equal(config.semana, '2026-11-09');
    const { rows: envios } = await db.query("SELECT supervisor_id, TO_CHAR(semana_inicio, 'YYYY-MM-DD') AS semana FROM envios_relatorios_semanais");
    assert.deepEqual(envios, [{ supervisor_id: PESSOAS.supervisor, semana: '2026-11-09' }]);

    // na mesma semana não repete
    assert.deepEqual(await executar(), { enviado: false, motivo: 'ja_enviado' });
    assert.equal(enviados.length, 1);
});

test('supervisor já notificado na semana não recebe de novo, mesmo sem a marca da configuração', async () => {
    await configurar(true, 1, '08:00');
    await db.query(`INSERT INTO envios_relatorios_semanais (semana_inicio, supervisor_id) VALUES ('2026-11-09', ${PESSOAS.supervisor})`);
    assert.deepEqual(await executar(), { enviado: false, motivo: 'ja_enviado' });
    const { rows: [config] } = await db.query("SELECT TO_CHAR(ultimo_envio_semana, 'YYYY-MM-DD') AS semana FROM configuracoes_relatorio_semanal");
    assert.equal(config.semana, '2026-11-09');
});

test('sem supervisores que aceitem receber, nada é enviado', async () => {
    await configurar(true, 1, '08:00');
    await db.query('UPDATE professores SET receber_relatorio_semanal = false');
    assert.deepEqual(await executar(), { enviado: false, motivo: 'sem_destinatarios' });
});

test('envio manual ignora a programação e não marca a semana', async () => {
    await configurar(false, 4, '23:45', '2026-11-09');
    assert.equal((await executar({ forcar: true })).enviado, true);
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM envios_relatorios_semanais');
    assert.equal(rows[0].n, 0);
});

test('sem a linha de configuração o job falha com orientação', async () => {
    await db.query('DELETE FROM configuracoes_relatorio_semanal');
    await assert.rejects(executar(), /Aplique a migração 011/);
    await db.query("INSERT INTO configuracoes_relatorio_semanal (id, habilitado, dia_semana, horario) VALUES (1, false, 1, '08:00')");
});

test('o e-mail escapa nomes e leva o link de cada estagiário', () => {
    const { html, texto } = montarEmail([{ nome: 'Sup <b>', alunos: [{ aluno_id: 7, aluno_nome: 'Ana & Cia', carga_horaria: 60,
        horas_semana: 0, horas_registradas: 0, horas_validadas: 0, horas_pendentes: 0, atividades_semana: 0, atividades_pendentes: 0 }] }], 'https://x.test');
    assert.match(html, /Sup &lt;b&gt;/);
    assert.match(html, /Ana &amp; Cia/);
    assert.match(texto, /atividades preenchidas na semana: Não; para avaliar: nenhuma pendente — https:\/\/x\.test\/professor\/aluno\/7/);
});
