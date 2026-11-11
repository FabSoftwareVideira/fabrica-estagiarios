const nodemailer = require('nodemailer');

function escaparHtml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (caractere) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[caractere]);
}

function obterConfiguracaoEmail() {
    const { APP_ENV, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_URL } = process.env;
    const smtpHost = String(SMTP_HOST || '').trim();
    const smtpUser = String(SMTP_USER || '').trim();
    const senhaInformada = String(SMTP_PASS || '').trim();
    // O Google exibe a senha de app em quatro blocos separados por espaços;
    // esses espaços são apenas visuais e não fazem parte da credencial SMTP.
    const smtpPass = smtpHost.toLowerCase() === 'smtp.gmail.com'
        ? senhaInformada.replace(/\s/g, '')
        : senhaInformada;
    const autenticacaoConfigurada = Boolean(smtpUser && smtpPass);

    if (!smtpHost) {
        throw new Error('Configure SMTP_HOST no ambiente.');
    }

    if (APP_ENV !== 'development' && !autenticacaoConfigurada) {
        throw new Error('Configure SMTP_USER e SMTP_PASS no ambiente de produção.');
    }

    if (!APP_URL) {
        throw new Error('Configure APP_URL com a URL pública da aplicação.');
    }

    let urlAplicacao;
    try {
        urlAplicacao = new URL(APP_URL);
    } catch {
        throw new Error('APP_URL precisa ser uma URL válida, por exemplo https://estagios.exemplo.br.');
    }

    if (!['http:', 'https:'].includes(urlAplicacao.protocol)) {
        throw new Error('APP_URL precisa usar HTTP ou HTTPS.');
    }

    return {
        urlAplicacao: urlAplicacao.origin,
        remetente: SMTP_FROM || smtpUser,
        enderecoRemetente: smtpUser,
        transporte: nodemailer.createTransport({
            host: smtpHost,
            port: Number(SMTP_PORT) || 587,
            secure: Number(SMTP_PORT) === 465,
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 60000,
            ...(autenticacaoConfigurada ? { auth: { user: smtpUser, pass: smtpPass } } : {}),
        }),
    };
}

module.exports = { obterConfiguracaoEmail, escaparHtml };
