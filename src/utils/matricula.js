// Matrícula do estudante no IFC: opcional, mas só com números (ex.: 2025008076).
// Espaços digitados ou colados no meio são ignorados.
const MENSAGEM_MATRICULA = 'A matrícula deve ter apenas números, com até 20 dígitos (ex.: 2025008076).';

// { valida, valor }: valor é a matrícula limpa, ou null quando não foi informada.
function lerMatricula(entrada) {
    const valor = typeof entrada === 'string' ? entrada.replace(/\s+/g, '') : '';
    if (!valor) return { valida: true, valor: null };
    return { valida: /^\d{1,20}$/.test(valor), valor };
}

module.exports = { lerMatricula, MENSAGEM_MATRICULA };
