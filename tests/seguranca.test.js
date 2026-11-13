// Proteções de sessão e de origem: CSRF, sessão nova no login, login de
// desenvolvimento e segredo da sessão.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const express = require('express');
const { verificarOrigem } = require('../src/middleware/origem');
const { iniciarSessao } = require('../src/middleware/auth');

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
