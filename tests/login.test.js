const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const session = require('express-session');

let server;
let url;
const envOriginal = process.env.APP_ENV;

before(async () => {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../src/views'));
    app.locals.icone = require('../src/utils/icones').icone;
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: false }));
    app.use(require('../src/middleware/auth').attachUser);
    app.use('/', require('../src/routes/index'));
    app.use('/', require('../src/routes/auth'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => { process.env.APP_ENV = envOriginal; });
after(async () => { await new Promise((resolve) => server.close(resolve)); });

test('em produção o login é só com Google: sem botão e sem rotas do GitHub', async () => {
    process.env.APP_ENV = 'production';
    const pagina = await (await fetch(`${url}/`)).text();
    assert.match(pagina, /href="\/auth\/google"/);
    assert.doesNotMatch(pagina, /href="\/auth\/github"/);
    assert.doesNotMatch(pagina, /GitHub/);

    for (const rota of ['/auth/github', '/auth/github/callback?code=x&state=y']) {
        const resposta = await fetch(url + rota, { redirect: 'manual' });
        assert.equal(resposta.status, 302, rota);
        assert.equal(resposta.headers.get('location'), '/', rota);
    }
});

test('fora de produção o botão do GitHub continua disponível para testes', async () => {
    process.env.APP_ENV = 'development';
    const pagina = await (await fetch(`${url}/`)).text();
    assert.match(pagina, /href="\/auth\/google"/);
    assert.match(pagina, /href="\/auth\/github"/);
});
