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

for (const ambiente of ['production', 'development']) {
    test(`login só com Google em ${ambiente}: sem botão e sem rotas do GitHub`, async () => {
        process.env.APP_ENV = ambiente;
        const pagina = await (await fetch(`${url}/`)).text();
        assert.match(pagina, /href="\/auth\/google"/);
        assert.doesNotMatch(pagina, /href="\/auth\/github"/);
        assert.doesNotMatch(pagina, /GitHub/);

        for (const rota of ['/auth/github', '/auth/github/callback?code=x&state=y']) {
            const resposta = await fetch(url + rota, { redirect: 'manual' });
            assert.equal(resposta.status, 404, rota);
        }
    });
}

test('aviso de privacidade e cookies: público, com link discreto no rodapé', async () => {
    const aviso = await fetch(`${url}/privacidade`);
    assert.equal(aviso.status, 200);
    const html = await aviso.text();
    assert.match(html, /<h1>Privacidade e cookies<\/h1>/);
    assert.match(html, /connect\.sid/);
    assert.match(html, /LGPD/);
    // sem banner de consentimento: só o cookie essencial de sessão
    assert.doesNotMatch(html, /Aceitar cookies/i);

    const entrada = await (await fetch(`${url}/`)).text();
    assert.doesNotMatch(entrada, /public-privacidade/);
    assert.match(entrada, /<footer[^]*href="\/privacidade"[^]*<\/footer>/);
    // a página inicial não cria cookie antes do login
    assert.equal((await fetch(`${url}/`)).headers.get('set-cookie'), null);
});
