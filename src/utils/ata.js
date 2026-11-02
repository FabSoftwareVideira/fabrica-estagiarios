// Regras de cálculo da ata da banca (FARE).
//
//   I.   Acompanhamento (peso 4)  - FAC (peso 2) e FAPO (peso 2)
//   II.  Banca (peso 5)           - apresentação (2), prática (2) e relatório (1),
//                                   cada um com a média das notas N1, N2 e N3
//   III. Autoavaliação (peso 1)   - FAA (peso 1)
//
// Os pesos somam 10, então a nota final (0 a 10) é a soma de
// (nota x peso) dividida por 10.

const CRITERIOS_BANCA = [
    { chave: 'apresentacao', titulo: 'Apresentação oral', peso: 2 },
    { chave: 'pratica', titulo: 'Prática profissional', peso: 2 },
    { chave: 'relatorio', titulo: 'Relatório descritivo', peso: 1 },
];

const PESOS = { fac: 2, fapo: 2, faa: 1 };
const SOMA_PESOS = 10;

const RESULTADOS = {
    aprovado: 'Aprovado',
    aprovado_ressalva: 'Aprovado com ressalva',
    reprovado: 'Reprovado',
};

function arredondar(valor, casas = 2) {
    const fator = 10 ** casas;
    return Math.round((Number(valor) + Number.EPSILON) * fator) / fator;
}

function ehNumero(valor) {
    return valor !== null && valor !== undefined && valor !== '' && Number.isFinite(Number(valor));
}

// média das notas preenchidas; null se nenhuma foi informada
function media(valores) {
    const validos = (valores || []).filter(ehNumero).map(Number);
    if (validos.length === 0) return null;
    return validos.reduce((soma, n) => soma + n, 0) / validos.length;
}

// média aritmética das 10 notas da FAA
function notaDaFaa(faa) {
    if (!faa || !Array.isArray(faa.notas) || faa.notas.length === 0) return null;
    return media(faa.notas);
}

function pontos(nota, peso) {
    return ehNumero(nota) ? (Number(nota) * peso) / SOMA_PESOS : null;
}

// banca: [[N1,N2,N3] x 3 critérios]
function calcularAta({ fac, fapo, faa, banca }) {
    const mediasBanca = CRITERIOS_BANCA.map((_, i) => media((banca || [])[i]));

    const linhas = {
        fac: { nota: ehNumero(fac) ? Number(fac) : null, peso: PESOS.fac },
        fapo: { nota: ehNumero(fapo) ? Number(fapo) : null, peso: PESOS.fapo },
        faa: { nota: ehNumero(faa) ? Number(faa) : null, peso: PESOS.faa },
    };
    CRITERIOS_BANCA.forEach((criterio, i) => {
        linhas[criterio.chave] = { nota: mediasBanca[i], peso: criterio.peso };
    });

    let final = 0;
    Object.values(linhas).forEach((linha) => {
        linha.pontos = pontos(linha.nota, linha.peso);
        if (linha.pontos !== null) final += linha.pontos;
    });

    return { linhas, mediasBanca, final: arredondar(final, 2) };
}

function formatarNotaBr(valor, casas = 1) {
    if (!ehNumero(valor)) return '';
    return Number(valor).toFixed(casas).replace('.', ',');
}

module.exports = {
    CRITERIOS_BANCA,
    PESOS,
    RESULTADOS,
    arredondar,
    ehNumero,
    media,
    notaDaFaa,
    calcularAta,
    formatarNotaBr,
};
