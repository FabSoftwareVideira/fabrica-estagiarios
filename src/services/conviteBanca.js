// Aviso por e-mail da banca, com convite de calendário (.ics) anexado.
// Gmail/Google Agenda, Outlook e Apple Mail reconhecem o convite e oferecem
// "Adicionar à agenda"; remarcar atualiza o mesmo evento e cancelar o remove,
// porque o UID é fixo por estudante e a SEQUENCE acompanha a versão da banca.
const { obterConfiguracaoEmail, escaparHtml } = require('./email');
const { formatarDataBr } = require('../utils/datas');

let configurarEmail = obterConfiguracaoEmail;
// Permite trocar o transporte na demonstração e nos testes.
function usarConfiguracaoEmail(fn) { configurarEmail = fn || obterConfiguracaoEmail; }

const textoIcs = (valor) => String(valor ?? '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Valor de parâmetro (CN=...): sem aspas nem caracteres de controle, e entre
// aspas quando tem ":", ";" ou ",", que encerrariam o parâmetro.
function parametroIcs(valor) {
    const limpo = String(valor ?? '').replace(/["\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return /[:;,]/.test(limpo) ? `"${limpo}"` : limpo;
}
// Endereços (URL e mailto) vão sem escape: nunca podem trazer quebra de linha.
const enderecoIcs = (valor) => String(valor ?? '').replace(/[\s\u0000-\u001f\u007f]/g, '');

// Linhas de até 75 octetos, como pede a RFC 5545.
function dobrar(linha) {
    const partes = [];
    let atual = '';
    for (const caractere of linha) {
        if (Buffer.byteLength(atual + caractere) > (partes.length ? 74 : 75)) {
            partes.push(atual);
            atual = caractere;
        } else atual += caractere;
    }
    partes.push(atual);
    return partes.join('\r\n ');
}

// Brasília não tem horário de verão desde 2019: UTC-3 fixo.
function paraUtc(data, hora) {
    return new Date(`${data}T${hora}:00-03:00`).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Quem desativou os avisos de banca no perfil fica fora da lista.
function participantesDaBanca(banca) {
    return [
        { papel: 'Orientador', nome: banca.orientador_nome, email: banca.orientador_email, recebe: banca.orientador_recebe_email },
        { papel: 'Avaliador 1', nome: banca.avaliador_1_nome, email: banca.avaliador_1_email, recebe: banca.avaliador_1_recebe_email },
        { papel: 'Avaliador 2', nome: banca.avaliador_2_nome, email: banca.avaliador_2_email, recebe: banca.avaliador_2_recebe_email },
        { papel: 'Estudante', nome: banca.aluno_nome, email: banca.aluno_email, recebe: banca.aluno_recebe_email },
        ...(banca.convidar_supervisor
            ? [{ papel: 'Supervisor (convidado)', nome: banca.supervisor_nome, email: banca.supervisor_email, recebe: banca.supervisor_recebe_email, opcional: true }]
            : []),
    ]
        .filter((p) => p.email && p.recebe !== false)
        // o supervisor pode já estar na banca como avaliador: não repete
        .filter((p, i, todos) => todos.findIndex((o) => o.email.toLowerCase() === p.email.toLowerCase()) === i);
}

function gerarIcs(banca, { cancelada = false, organizador, dominio, participantes = participantesDaBanca(banca), agora = new Date() } = {}) {
    const descricao = [
        `Banca de estágio de ${banca.aluno_nome}${banca.empresa ? ` (${banca.empresa})` : ''}.`,
        `Orientador: ${banca.orientador_nome}. Avaliadores: ${banca.avaliador_1_nome} e ${banca.avaliador_2_nome}.`,
        banca.link_reuniao ? `Link da reunião: ${banca.link_reuniao}` : '',
        banca.observacoes ? `Observações: ${banca.observacoes}` : '',
    ].filter(Boolean).join('\n');

    const linhas = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//IFC Videira//Controle de Estagio//PT-BR',
        'CALSCALE:GREGORIAN',
        `METHOD:${cancelada ? 'CANCEL' : 'REQUEST'}`,
        'BEGIN:VEVENT',
        `UID:banca-${banca.aluno_id}@${dominio}`,
        `SEQUENCE:${Number(banca.versao) || 0}`,
        `DTSTAMP:${agora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
        `DTSTART:${paraUtc(banca.data, banca.hora_inicio)}`,
        `DTEND:${paraUtc(banca.data, banca.hora_fim)}`,
        `SUMMARY:${textoIcs(`Banca de estágio · ${banca.aluno_nome}`)}`,
        `LOCATION:${textoIcs(banca.sala)}`,
        `DESCRIPTION:${textoIcs(descricao)}`,
        ...(banca.link_reuniao ? [`URL:${enderecoIcs(banca.link_reuniao)}`] : []),
        `STATUS:${cancelada ? 'CANCELLED' : 'CONFIRMED'}`,
        `ORGANIZER;CN=${parametroIcs('Controle de Estágio')}:mailto:${enderecoIcs(organizador)}`,
        ...participantes.map((p) => `ATTENDEE;CN=${parametroIcs(p.nome)};ROLE=${p.opcional ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT'};PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${enderecoIcs(p.email)}`),
        'END:VEVENT',
        'END:VCALENDAR',
    ];
    return linhas.map(dobrar).join('\r\n') + '\r\n';
}

const TEXTOS = {
    agendada: { assunto: 'Banca de estágio agendada', abertura: 'Uma banca de estágio foi agendada e você participa dela.' },
    remarcada: { assunto: 'Banca de estágio remarcada', abertura: 'A banca de estágio abaixo foi remarcada. Confira os novos dados.' },
    cancelada: { assunto: 'Banca de estágio cancelada', abertura: 'A banca de estágio abaixo foi cancelada.' },
    removido: { assunto: 'Você não participa mais da banca de estágio', abertura: 'A composição da banca abaixo mudou e você não faz mais parte dela.' },
};

function montarEmail(banca, tipo, urlAplicacao) {
    const { assunto, abertura } = TEXTOS[tipo];
    const quando = `${formatarDataBr(banca.data)}, das ${banca.hora_inicio} às ${banca.hora_fim} (horário de Brasília)`;
    const linhas = [
        ['Estudante', banca.aluno_nome],
        ['Quando', quando],
        ['Local', banca.sala],
        ...(banca.link_reuniao ? [['Link da reunião', banca.link_reuniao]] : []),
        ['Orientador', banca.orientador_nome],
        ['Avaliadores', `${banca.avaliador_1_nome} e ${banca.avaliador_2_nome}`],
        ...(banca.convidar_supervisor && banca.supervisor_nome ? [['Supervisor (convidado)', banca.supervisor_nome]] : []),
        ...(banca.observacoes ? [['Observações', banca.observacoes]] : []),
    ];
    const cancelamento = tipo === 'cancelada' || tipo === 'removido';
    const rodape = cancelamento
        ? 'O convite em anexo remove o evento da sua agenda.'
        : 'O convite em anexo adiciona a banca à sua agenda (Google Agenda, Outlook e outros).';
    const link = `${urlAplicacao}/professor/bancas`;
    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;">
            <h2 style="color:#071d41;margin:0 0 8px;">${escaparHtml(assunto)}</h2>
            <p>${escaparHtml(abertura)}</p>
            <table style="border-collapse:collapse;font-size:14px;width:100%;">
                ${linhas.map(([rotulo, valor]) => `<tr>
                    <td style="padding:6px 12px 6px 0;color:#4b5563;white-space:nowrap;vertical-align:top;">${escaparHtml(rotulo)}</td>
                    <td style="padding:6px 0;font-weight:bold;">${escaparHtml(valor)}</td>
                </tr>`).join('')}
            </table>
            <p style="color:#4b5563;font-size:13px;">${escaparHtml(rodape)}</p>
            <p><a href="${escaparHtml(link)}" style="color:#1351b4;">Abrir a agenda de bancas</a></p>
        </div>`;
    const text = [abertura, '', ...linhas.map(([rotulo, valor]) => `${rotulo}: ${valor}`), '', rodape, link].join('\n');
    return { subject: `${assunto} · ${banca.aluno_nome}`, html, text };
}

// tipo: 'agendada' | 'remarcada' | 'cancelada' | 'removido'.
// destinatarios (opcional) restringe o envio, por exemplo a um avaliador substituído.
// Nunca lança erro: a banca já está salva; devolve { ok, erro } para a rota avisar.
async function notificarBanca(banca, tipo, destinatarios) {
    try {
        const para = (destinatarios || participantesDaBanca(banca)).filter((p) => p.email);
        if (!para.length) return { ok: true, enviados: 0 };
        const { transporte, remetente, enderecoRemetente, urlAplicacao } = configurarEmail();
        const organizador = enderecoRemetente || 'estagios@localhost';
        const cancelada = tipo === 'cancelada' || tipo === 'removido';
        const ics = gerarIcs(banca, { cancelada, organizador, dominio: new URL(urlAplicacao).hostname, participantes: para });
        // o agendamento não pode ficar preso a um servidor de e-mail lento
        let relogio;
        const limite = new Promise((_, rejeitar) => { relogio = setTimeout(() => rejeitar(new Error('Tempo esgotado ao enviar o e-mail.')), 15000); });
        const info = await Promise.race([limite, transporte.sendMail({
            from: remetente,
            to: para.map((p) => ({ name: p.nome, address: p.email })),
            ...montarEmail(banca, tipo, urlAplicacao),
            icalEvent: { method: cancelada ? 'CANCEL' : 'REQUEST', filename: 'banca.ics', content: ics },
        })]).finally(() => clearTimeout(relogio));
        if (info && info.rejected && info.rejected.length) throw new Error('Destinatário recusado pelo servidor de e-mail.');
        return { ok: true, enviados: para.length };
    } catch (erro) {
        console.error('[banca] não foi possível enviar o aviso por e-mail:', erro.message);
        return { ok: false, erro: erro.message };
    }
}

module.exports = { notificarBanca, gerarIcs, montarEmail, participantesDaBanca, usarConfiguracaoEmail };
