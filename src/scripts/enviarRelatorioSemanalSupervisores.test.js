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
                atividades_semana: 2,
                atividades_pendentes: 2,
            },
            {
                aluno_id: 2,
                aluno_nome: 'Estudante sem pendências',
                horas_semana: 3,
                atividades_semana: 1,
                atividades_pendentes: 0,
            },
        ],
    }];

    const { html, texto } = montarEmail(supervisores, 'https://estagios.exemplo.br');

    assert.match(html, /2 pendente\(s\)/);
    assert.match(html, /Nenhuma pendente/);
    assert.match(html, /<th[^>]*>Para avaliar<\/th>/);
    assert.match(texto, /para avaliar: 2 pendente\(s\)/);
    assert.match(texto, /para avaliar: nenhuma pendente/);
});
