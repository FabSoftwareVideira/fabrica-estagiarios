const { dataIsoValida } = require('./datas');
const { ehCurso } = require('../config/cursos');

const CRITERIOS_FAC = [
    ['Interesse', 'Preocupação para conhecer os aspectos relacionados ao trabalho/empresa.'],
    ['Iniciativa', 'Iniciativa demonstrada para desenvolver seus trabalhos sem dependência de outros.'],
    ['Cooperação', 'Disposição para cooperar e atender prontamente às solicitações.'],
    ['Assiduidade', 'Frequência ao(s) local(is) de estágio conforme cronograma.'],
    ['Pontualidade', 'Comparecimento ao(s) local(is) de estágio em horários marcados.'],
    ['Disciplina', 'Observância das normas e regulamentos internos da empresa.'],
    ['Sociabilidade', 'Facilidade de integração com as pessoas.'],
    ['Adaptabilidade', 'Facilidade em compreender e se adaptar às situações do dia a dia de trabalho.'],
    ['Senso de Responsabilidade', 'Zelo pelo material, bens e equipamentos da empresa.'],
    ['Ética', 'Conduta em relação aos padrões e costumes.'],
];

function mediaFac(notas) {
    const somaDecimos = notas.reduce((total, n) => total + Math.round(Number(n) * 10), 0);
    return Math.round(somaDecimos / 10) / 10;
}

function lerFac(body, cursoAluno) {
    const erros = [];
    const valores = { curso: ehCurso(cursoAluno) ? cursoAluno : '' };
    if (!valores.curso) erros.push('O estudante precisa informar o curso no perfil antes de preencher a FAC.');
    for (const [campo, rotulo, limite, obrigatorio] of [
        ['empresa', 'Empresa', 60, true], ['periodo', 'Período', 35, true], ['atividades', 'Atividades', 300, true],
        ['comentarios', 'Comentários', 300, false], ['local_assinatura', 'Local', 80, true],
    ]) {
        valores[campo] = typeof body[campo] === 'string' ? body[campo].trim() : '';
        if ((obrigatorio && !valores[campo]) || valores[campo].length > limite) {
            erros.push(`${rotulo}: ${obrigatorio ? 'preencha com' : 'use'} até ${limite} caracteres.`);
        }
    }
    valores.notas = CRITERIOS_FAC.map(([titulo], i) => {
        const bruto = typeof body[`nota_${i}`] === 'string' ? body[`nota_${i}`].trim().replace(',', '.') : '';
        const numero = bruto === '' ? NaN : Number(bruto);
        if (!Number.isFinite(numero) || numero < 0 || numero > 10 || Math.abs(numero * 100 - Math.round(numero * 100)) > 1e-8) {
            erros.push(`${titulo}: informe uma nota de 0 a 10, com até duas casas decimais.`);
            return bruto;
        }
        return numero;
    });
    valores.data_assinatura = typeof body.data_assinatura === 'string' ? body.data_assinatura : '';
    if (!dataIsoValida(valores.data_assinatura)) erros.push('Informe uma data de assinatura válida.');
    return { valores, erros };
}

module.exports = { CRITERIOS_FAC, mediaFac, lerFac };
