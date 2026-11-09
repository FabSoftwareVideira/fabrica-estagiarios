const DIAS_TRABALHO = [
    { id: 1, nome: 'Segunda-feira' },
    { id: 2, nome: 'Terça-feira' },
    { id: 3, nome: 'Quarta-feira' },
    { id: 4, nome: 'Quinta-feira' },
    { id: 5, nome: 'Sexta-feira' },
    { id: 6, nome: 'Sábado' },
];

function validarHorarioTrabalho(diasSelecionados, corpo) {
    const dias = Array.isArray(diasSelecionados)
        ? diasSelecionados
        : (diasSelecionados ? [diasSelecionados] : []);
    const selecionados = [...new Set(dias)];

    if (selecionados.length === 0 || selecionados.some((dia) =>
        !/^[1-6]$/.test(String(dia)))) {
        return { erro: 'Selecione ao menos um dia de trabalho válido, de segunda a sábado.' };
    }

    const horarioTrabalho = {};
    for (const dia of selecionados) {
        const inicio = corpo[`horario_inicio_${dia}`];
        const fim = corpo[`horario_fim_${dia}`];
        const formatoHorario = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

        if (typeof inicio !== 'string' || typeof fim !== 'string'
            || !formatoHorario.test(inicio) || !formatoHorario.test(fim)) {
            return { erro: 'Informe entrada e saída para cada dia selecionado.' };
        }

        const minutosInicio = Number(inicio.slice(0, 2)) * 60 + Number(inicio.slice(3));
        const minutosFim = Number(fim.slice(0, 2)) * 60 + Number(fim.slice(3));
        const duracaoMinutos = minutosFim - minutosInicio;
        if (duracaoMinutos <= 0) {
            return { erro: 'O horário de saída deve ser posterior ao de entrada.' };
        }
        if (duracaoMinutos > 6 * 60) {
            return { erro: 'A jornada planejada não pode ultrapassar 6 horas por dia.' };
        }

        horarioTrabalho[dia] = { inicio, fim };
    }

    return { horarioTrabalho };
}

module.exports = { DIAS_TRABALHO, validarHorarioTrabalho };
