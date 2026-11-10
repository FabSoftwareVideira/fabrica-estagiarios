const { dataIsoValida } = require('./datas');

const SITUACOES_BANCA = {
    agendada: 'Agendada', remarcada: 'Remarcada', cancelada: 'Cancelada', realizada: 'Realizada',
};

function agoraBrasilia(data = new Date()) {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(data).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    return { data: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}` };
}

function lerAgendamento(body, agora = agoraBrasilia()) {
    const texto = (campo) => typeof body[campo] === 'string' ? body[campo].trim() : '';
    const valores = Object.fromEntries(['data', 'hora_inicio', 'hora_fim', 'sala', 'link_reuniao', 'observacoes', 'avaliador_1_id', 'avaliador_2_id', 'versao'].map((k) => [k, texto(k)]));
    // caixa marcada chega como 'on'; desmarcada não é enviada
    valores.convidar_supervisor = body.convidar_supervisor === 'on' || body.convidar_supervisor === 'true';
    const erros = [];
    if (!dataIsoValida(valores.data)) erros.push('Informe uma data válida.');
    const horaValida = (hora) => /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
    if (!horaValida(valores.hora_inicio) || !horaValida(valores.hora_fim)) erros.push('Informe os horários de início e término.');
    else if (valores.hora_fim <= valores.hora_inicio) erros.push('O término deve ser posterior ao início, no mesmo dia.');
    if (dataIsoValida(valores.data) && horaValida(valores.hora_inicio)
        && `${valores.data} ${valores.hora_inicio}` <= `${agora.data} ${agora.hora}`) {
        erros.push('Escolha uma data e horário futuros, no horário de Brasília.');
    }
    if (!valores.sala || valores.sala.length > 120) erros.push('Informe uma sala/local com até 120 caracteres.');
    if (valores.observacoes.length > 1000) erros.push('Use até 1.000 caracteres nas observações.');
    if (valores.link_reuniao) {
        try {
            const url = new URL(valores.link_reuniao);
            if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || valores.link_reuniao.length > 1000) throw new Error();
        } catch { erros.push('Informe um link de reunião HTTP ou HTTPS válido.'); }
    }
    for (const campo of ['avaliador_1_id', 'avaliador_2_id']) {
        if (!/^[1-9]\d*$/.test(valores[campo]) || !Number.isSafeInteger(Number(valores[campo]))) erros.push('Selecione os dois avaliadores cadastrados.');
    }
    if (valores.avaliador_1_id && valores.avaliador_1_id === valores.avaliador_2_id) erros.push('Selecione dois avaliadores diferentes.');
    if (!/^\d+$/.test(valores.versao) || !Number.isSafeInteger(Number(valores.versao))) erros.push('Atualize a página antes de salvar.');
    return { valores, erros: [...new Set(erros)] };
}

function celulaCsv(valor) {
    let texto = String(valor ?? '');
    if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(texto)) texto = "'" + texto;
    return `"${texto.replace(/"/g, '""')}"`;
}

module.exports = { SITUACOES_BANCA, agoraBrasilia, lerAgendamento, celulaCsv };
