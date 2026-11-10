const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const codigo = fs.readFileSync(require('node:path').join(__dirname, '../src/public/js/theme.js'), 'utf8');

function navegador({ contraste, bloqueado = false } = {}) {
    const classes = [];
    vm.runInNewContext(codigo, {
        document: { documentElement: { classList: { add: (c) => classes.push(c) } } },
        localStorage: {
            getItem(k) { if (bloqueado) throw new Error('bloqueado'); return k === 'contraste' ? contraste : null; },
        },
    });
    return classes;
}

test('alto contraste salvo é reaplicado antes do CSS', () => {
    assert.deepEqual(navegador({ contraste: '1' }), ['alto-contraste']);
});
test('sem escolha ou com contraste desligado a página fica no tema claro', () => {
    assert.deepEqual(navegador(), []);
    assert.deepEqual(navegador({ contraste: '0' }), []);
});
test('armazenamento indisponível não quebra a página', () => {
    assert.deepEqual(navegador({ bloqueado: true }), []);
});
