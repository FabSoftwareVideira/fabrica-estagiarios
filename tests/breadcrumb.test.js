const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const views = path.join(__dirname, '../src/views');
const telas = () => fs.readdirSync(views).filter((nome) => nome.endsWith('.ejs'));

test('toda tela tem navegação por breadcrumb', () => {
    const semBreadcrumb = telas().filter((nome) => !fs.readFileSync(path.join(views, nome), 'utf8').includes('partials/breadcrumb'));
    assert.deepEqual(semBreadcrumb, [], `telas sem breadcrumb: ${semBreadcrumb.join(', ') || '(nenhuma)'}`);
});

test('o partial de breadcrumb tem uma trilha acessível e marca a página atual', () => {
    const parcial = fs.readFileSync(path.join(views, 'partials/breadcrumb.ejs'), 'utf8');
    assert.match(parcial, /<nav class="breadcrumb"/);
    assert.match(parcial, /aria-current="page"/);
    // o último item nunca é um link: ele representa a própria página
    assert.match(parcial, /i < itens\.length - 1/);
});
