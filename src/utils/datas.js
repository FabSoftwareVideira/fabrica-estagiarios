// Funções de data/hora usadas pelas rotas e pelos PDFs.
// O driver do Postgres devolve colunas DATE como Date no fuso local do
// servidor, por isso tudo aqui trabalha com o calendário local.

function dataLocalIso(data = new Date()) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

function dataIsoValida(valor) {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

    const [ano, mes, dia] = valor.split('-').map(Number);
    const data = new Date(ano, mes - 1, dia);

    return data.getFullYear() === ano
        && data.getMonth() === mes - 1
        && data.getDate() === dia;
}

// aceita Date, "YYYY-MM-DD" ou timestamp e devolve "YYYY-MM-DD" (ou '')
function dataParaInput(valor) {
    if (!valor) return '';
    if (typeof valor === 'string') return valor.slice(0, 10);

    const data = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(data.getTime()) ? '' : dataLocalIso(data);
}

function formatarDataBr(valor) {
    const iso = dataParaInput(valor);
    if (!iso) return '';
    const [ano, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${ano}`;
}

function formatarHora(valor) {
    if (!valor) return '';
    return String(valor).substring(0, 5);
}

// "Ana Paula da Silva" -> "Ana-Paula-da-Silva" (nome de arquivo seguro)
function nomeParaArquivo(nome, padrao = 'aluno') {
    return String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || padrao;
}

// "01/03/2026 a 30/09/2026" a partir das atividades validadas
function periodoDasAtividades(atividades) {
    const datas = (atividades || [])
        .filter((a) => a.status_validacao === 'validada')
        .map((a) => dataParaInput(a.data))
        .filter(Boolean)
        .sort();

    if (datas.length === 0) return '';
    return `${formatarDataBr(datas[0])} a ${formatarDataBr(datas[datas.length - 1])}`;
}

module.exports = {
    dataLocalIso,
    dataIsoValida,
    dataParaInput,
    formatarDataBr,
    formatarHora,
    nomeParaArquivo,
    periodoDasAtividades,
};
