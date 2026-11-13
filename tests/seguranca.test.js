// Proteções de sessão e de origem: CSRF, sessão nova no login, login de
// desenvolvimento e segredo da sessão.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const express = require('express');
const { verificarOrigem } = require('../src/middleware/origem');
const { iniciarSessao } = require('../src/middleware/auth');
const { cabecalhosSeguranca, normalizarCorpo } = require('../src/middleware/seguranca');
const { gerarIcs } = require('../src/services/conviteBanca');
const { lerAgendamento } = require('../src/utils/bancas');

let server, url, host;
const envOriginal = { APP_ENV: process.env.APP_ENV, APP_URL: process.env.APP_URL };

before(async () => {
    const app = express();
    app.use(verificarOrigem);
    app.all('/{*rota}', (req, res) => res.send('ok'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    host = `127.0.0.1:${server.address().port}`;
    url = `http://${host}`;
});
afterEach(() => {
    for (const [chave, valor] of Object.entries(envOriginal)) {
        if (valor === undefined) delete process.env[chave]; else process.env[chave] = valor;
    }
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

const enviar = (headers, { method = 'POST', rota = '/professor/usuarios/1/papeis' } = {}) =>
    fetch(url + rota, { method, headers, redirect: 'manual' }).then((r) => r.status);

test('POST só é aceito quando parte de uma página da própria aplicação', async () => {
    assert.equal(await enviar({ 'sec-fetch-site': 'same-origin' }), 200);
    assert.equal(await enviar({ origin: url }), 200);
    assert.equal(await enviar({ referer: `${url}/professor/usuarios` }), 200);

    // outro site, outro subdomínio do mesmo domínio e requisição sem origem
    assert.equal(await enviar({ 'sec-fetch-site': 'cross-site', origin: url }), 403);
    assert.equal(await enviar({ 'sec-fetch-site': 'same-site', origin: url }), 403);
    assert.equal(await enviar({ origin: 'https://outro-projeto.example.test' }), 403);
    assert.equal(await enviar({ origin: 'null' }), 403);
    assert.equal(await enviar({ referer: `http://${host}.example.test/` }), 403);
    assert.equal(await enviar({}), 403);
});

test('atrás de proxy, o host público de APP_URL também vale como origem', async () => {
    assert.equal(await enviar({ origin: 'https://estagios.example.test' }), 403);
    process.env.APP_URL = 'https://estagios.example.test';
    assert.equal(await enviar({ origin: 'https://estagios.example.test' }), 200);
});

test('navegação continua livre; o link de sair só é recusado vindo de outro site', async () => {
    assert.equal(await enviar({}, { method: 'GET' }), 200);
    assert.equal(await enviar({ 'sec-fetch-site': 'cross-site' }, { method: 'GET' }), 200);
    assert.equal(await enviar({ 'sec-fetch-site': 'same-origin' }, { method: 'GET', rota: '/logout' }), 200);
    assert.equal(await enviar({ 'sec-fetch-site': 'none' }, { method: 'GET', rota: '/logout' }), 200);
    assert.equal(await enviar({ 'sec-fetch-site': 'cross-site' }, { method: 'GET', rota: '/logout' }), 302);
    assert.equal(await enviar({ 'sec-fetch-site': 'same-site' }, { method: 'GET', rota: '/logout' }), 302);
});

test('o login grava o usuário em uma sessão nova', async () => {
    const eventos = [];
    const req = { session: { antigo: true, regenerate(callback) { eventos.push('regenerada'); req.session = { regenerate: this.regenerate }; callback(); } } };
    await iniciarSessao(req, { id: 7 });
    assert.deepEqual(eventos, ['regenerada']);
    assert.equal(req.session.user.id, 7);
    assert.equal(req.session.antigo, undefined);

    const falha = { session: { regenerate(callback) { callback(new Error('sem banco')); } } };
    await assert.rejects(iniciarSessao(falha, { id: 7 }), /sem banco/);
    assert.equal(falha.session.user, undefined);
});

test('login de desenvolvimento só existe com APP_ENV=development declarado', async () => {
    const app = express();
    app.use('/auth/dev', require('../src/routes/dev-login'));
    const dev = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => dev.once('listening', resolve));
    try {
        for (const ambiente of [undefined, '', 'production', 'staging']) {
            if (ambiente === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = ambiente;
            const resposta = await fetch(`http://127.0.0.1:${dev.address().port}/auth/dev/professor-admin`, { redirect: 'manual' });
            assert.equal(resposta.status, 404, `APP_ENV=${ambiente}`);
        }
    } finally {
        await new Promise((resolve) => dev.close(resolve));
    }
});

test('a aplicação não sobe fora de desenvolvimento sem um SESSION_SECRET próprio', () => {
    const carregar = (env) => {
        try {
            execFileSync(process.execPath, ['-e', "require('./src/app'); process.exit(0)"], {
                cwd: path.join(__dirname, '..'), stdio: 'pipe',
                env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
            });
            return 'subiu';
        } catch (erro) {
            return String(erro.stderr);
        }
    };
    assert.match(carregar({ APP_ENV: 'production' }), /Defina SESSION_SECRET/);
    assert.match(carregar({}), /Defina SESSION_SECRET/);
    assert.match(carregar({ APP_ENV: 'production', SESSION_SECRET: 'dev-secret-troque-em-producao' }), /Defina SESSION_SECRET/);
    assert.equal(carregar({ APP_ENV: 'production', SESSION_SECRET: 'um-segredo-de-verdade' }), 'subiu');
    assert.equal(carregar({ APP_ENV: 'development' }), 'subiu');
});

test('respostas levam os cabeçalhos de segurança; HSTS só em HTTPS', async () => {
    const resposta = (opcoes) => {
        const cabecalhos = {};
        cabecalhosSeguranca(opcoes)({}, { setHeader: (nome, valor) => { cabecalhos[nome.toLowerCase()] = valor; } }, () => {});
        return cabecalhos;
    };
    const http = resposta();
    assert.match(http['content-security-policy'], /default-src 'self'/);
    assert.match(http['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(http['content-security-policy'], /form-action 'self'/);
    assert.equal(http['x-content-type-options'], 'nosniff');
    assert.equal(http['x-frame-options'], 'DENY');
    assert.equal(http['referrer-policy'], 'same-origin');
    assert.equal(http['strict-transport-security'], undefined);
    assert.match(resposta({ https: true })['strict-transport-security'], /max-age=31536000/);
});

test('corpo forjado com listas ou objetos volta a ser texto simples', () => {
    const req = { body: {
        nome: ['a', 'Maria'], email: { $ne: '' }, empresa: [], curso: 'Curso', vazio: [{ x: 1 }],
        dias_trabalho: ['1', { x: 1 }, '3'], papeis: ['admin'],
    } };
    normalizarCorpo(req, {}, () => {});
    assert.deepEqual(req.body, { nome: 'Maria', curso: 'Curso', dias_trabalho: ['1', '3'], papeis: ['admin'] });

    for (const corpo of [undefined, null, 'texto', ['a']]) {
        const semCorpo = { body: corpo };
        normalizarCorpo(semCorpo, {}, () => {});
        assert.deepEqual(semCorpo.body, {});
    }
});

test('convite .ics não aceita linhas injetadas pelo link nem pelo nome', () => {
    const base = { data: '2030-01-10', hora_inicio: '09:00', hora_fim: '10:00', sala: 'Sala 1', observacoes: '',
        avaliador_1_id: '2', avaliador_2_id: '3', versao: '0' };
    const agora = { data: '2026-01-01', hora: '00:00' };
    assert.deepEqual(lerAgendamento({ ...base, link_reuniao: 'https://meet.example.test/abc' }, agora).erros, []);
    for (const link of ['https://meet.example.test/a\r\nATTENDEE:mailto:x@evil.test', 'https://meet.example.test/a b', 'https://meet.example.test/\tx']) {
        assert.match(lerAgendamento({ ...base, link_reuniao: link }, agora).erros.join(' '), /link de reunião/);
    }

    const ics = gerarIcs({
        aluno_id: 1, versao: 1, data: '2030-01-10', hora_inicio: '09:00', hora_fim: '10:00', sala: 'Sala 1',
        aluno_nome: 'Ana', orientador_nome: 'Orientador', avaliador_1_nome: 'A1', avaliador_2_nome: 'A2',
        link_reuniao: 'https://meet.example.test/a\r\nATTENDEE:mailto:x@evil.test',
    }, {
        organizador: 'estagios@example.test', dominio: 'example.test',
        participantes: [
            { nome: 'Fulano:mailto:outro@evil.test', email: 'fulano@example.test' },
            { nome: 'Linha\r\nBEGIN:VEVENT "x"', email: 'linha@example.test\r\nX-EVIL:1' },
            { nome: 'Professor Comum', email: 'comum@example.test' },
        ],
    }).replace(/\r\n /g, '');
    const linhas = ics.split('\r\n');
    assert.equal(linhas.filter((l) => l.startsWith('ATTENDEE')).length, 3);
    assert.equal(linhas.filter((l) => l.startsWith('BEGIN:VEVENT')).length, 1);
    assert.equal(linhas.some((l) => l.startsWith('X-EVIL')), false);
    assert.ok(linhas.includes('URL:https://meet.example.test/aATTENDEE:mailto:x@evil.test'));
    assert.ok(linhas.some((l) => l.startsWith('ATTENDEE;CN="Fulano:mailto:outro@evil.test";ROLE=')));
    assert.ok(linhas.some((l) => l.startsWith('ATTENDEE;CN="Linha BEGIN:VEVENT x";ROLE=')));
    assert.ok(linhas.some((l) => l.startsWith('ATTENDEE;CN=Professor Comum;ROLE=')));
});
