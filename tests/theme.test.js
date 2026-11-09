const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const codigo = fs.readFileSync(require('node:path').join(__dirname, '../src/public/js/theme.js'), 'utf8');

function navegador({ salvo, escuro = false, bloqueado = false } = {}) {
    const eventos = {};
    const root = { dataset: {}, classList: { add() {} } };
    const atributos = {};
    const botao = { setAttribute: (k, v) => { atributos[k] = v; }, addEventListener: (k, fn) => { eventos[k] = fn; } };
    const media = { matches: escuro, addEventListener: (_, fn) => { eventos.sistema = fn; } };
    const armazenamento = { tema: salvo };
    vm.runInNewContext(codigo, {
        document: { documentElement: root, querySelectorAll: () => [botao], addEventListener: (_, fn) => fn() },
        window: { matchMedia: () => media, addEventListener: (_, fn) => { eventos.storage = fn; } },
        localStorage: {
            getItem(k) { if (bloqueado) throw new Error('bloqueado'); return armazenamento[k]; },
            setItem(k, v) { if (bloqueado) throw new Error('bloqueado'); armazenamento[k] = v; },
        },
    });
    return { root, atributos, eventos, media, armazenamento };
}

test('tema acompanha o sistema antes de uma escolha manual', () => {
    const n = navegador({ escuro: true });
    assert.equal(n.root.dataset.theme, 'dark');
    assert.equal(n.atributos['aria-label'], 'Ativar tema claro');
    n.media.matches = false; n.eventos.sistema();
    assert.equal(n.root.dataset.theme, 'light');
    n.eventos.click();
    assert.equal(n.armazenamento.tema, 'dark');
    n.eventos.sistema();
    assert.equal(n.root.dataset.theme, 'dark');
});
test('escolha salva prevalece na próxima visita e sincroniza abas', () => {
    const n = navegador({ salvo: 'light', escuro: true });
    assert.equal(n.root.dataset.theme, 'light');
    n.eventos.storage({ key: 'tema', newValue: 'dark' });
    assert.equal(n.root.dataset.theme, 'dark');
    n.media.matches = false;
    n.eventos.storage({ key: 'tema', newValue: null });
    assert.equal(n.root.dataset.theme, 'light');
});
test('armazenamento indisponível e preferência inválida não quebram a alternância', () => {
    const n = navegador({ bloqueado: true });
    n.eventos.click();
    assert.equal(n.root.dataset.theme, 'dark');
    assert.equal(n.atributos['aria-pressed'], 'true');
    assert.equal(navegador({ salvo: 'inválido', escuro: true }).root.dataset.theme, 'dark');
});
