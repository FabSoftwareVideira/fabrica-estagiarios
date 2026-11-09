const assert = require('node:assert/strict');
const { test } = require('node:test');
const { montarEmail } = require('./enviarRelatorioSemanalSupervisores');

test('inclui badges de atividades pendentes e sem pendências no relatório', () => {
    const supervisores = [{
        nome: 'Supervisora',
        alunos: [
            {
                aluno_id: 1,
                aluno_nome: 'Estudante com pendências',
                horas_semana: 4,
                carga_horaria: 60,
                horas_registradas: 28,
                horas_validadas: 20,
                horas_pendentes: 8,
                atividades_semana: 2,
                atividades_pendentes: 2,
            },
            {
                aluno_id: 2,
                aluno_nome: 'Estudante sem pendências',
                horas_semana: 3,
                carga_horaria: 60,
                horas_registradas: 18,
                horas_validadas: 18,
                horas_pendentes: 0,
                atividades_semana: 1,
                atividades_pendentes: 0,
            },
        ],
    }];

    const { html, texto } = montarEmail(supervisores, 'https://estagios.exemplo.br');

    assert.match(html, /2 pendente\(s\)/);
    assert.match(html, /Nenhuma pendente/);
    assert.match(html, /<th[^>]*>Para avaliar<\/th>/);
    assert.match(html, /28\.00 \/ 60\.00 h/);
    assert.match(html, /20\.00 h/);
    assert.match(html, /2 pendente\(s\) — 8\.00 h/);
    assert.match(texto, /28\.00 de 60\.00 horas registradas no estágio/);
    assert.match(texto, /20\.00 horas validadas/);
    assert.match(texto, /2 pendente\(s\), 8\.00 horas/);
    assert.match(texto, /para avaliar: 2 pendente\(s\)/);
    assert.match(texto, /para avaliar: nenhuma pendente/);
});
