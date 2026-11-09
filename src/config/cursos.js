const CURSOS = Object.freeze([
    'Curso Técnico de Agropecuária Integrado ao Ensino Médio',
    'Curso Técnico em Eletroeletrônica Integrado ao Ensino Médio',
    'Curso Técnico em Informática Integrado ao Ensino Médio',
]);

function ehCurso(valor) {
    return CURSOS.includes(valor);
}

module.exports = { CURSOS, ehCurso };
