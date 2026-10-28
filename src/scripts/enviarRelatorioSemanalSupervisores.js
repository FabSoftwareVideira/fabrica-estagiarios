const nodemailer = require('nodemailer');
const { pool } = require('../config/database');

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
            ...(autenticacaoConfigurada ? { auth: { user: smtpUser, pass: smtpPass } } : {}),
        }),
    };
}

function montarEmail(supervisores, urlAplicacao) {
    const tabelasPorSupervisor = supervisores.map((supervisor) => {
        const linhas = supervisor.alunos.map((aluno) => {
            const quantidade = Number(aluno.atividades_semana);
            const statusAtividades = quantidade > 0 ? `Sim (${quantidade})` : 'Não';
            const linkAluno = `${urlAplicacao}/professor/aluno/${encodeURIComponent(aluno.aluno_id)}`;

            return `
                <tr>
                    <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escaparHtml(aluno.aluno_nome)}</td>
                    <td style="padding:10px;text-align:center;border-bottom:1px solid #e5e7eb;">${Number(aluno.horas_semana).toFixed(2)} h</td>
                    <td style="padding:10px;text-align:center;border-bottom:1px solid #e5e7eb;">${statusAtividades}</td>
                    <td style="padding:10px;text-align:center;border-bottom:1px solid #e5e7eb;"><a href="${escaparHtml(linkAluno)}" style="color:#2563eb;">Ver detalhes</a></td>
                </tr>`;
        }).join('');

        return `
            <h3 style="margin:24px 0 8px;color:#7a0078;">${escaparHtml(supervisor.nome)}</h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px;">
                <thead>
                    <tr style="background:#f9fafb;">
                        <th style="padding:10px;text-align:left;border-bottom:1px solid #d1d5db;">Estudante</th>
                        <th style="padding:10px;text-align:center;border-bottom:1px solid #d1d5db;">Horas registradas</th>
                        <th style="padding:10px;text-align:center;border-bottom:1px solid #d1d5db;">Preencheu atividades</th>
                        <th style="padding:10px;text-align:center;border-bottom:1px solid #d1d5db;">Detalhes</th>
                    </tr>
                </thead>
                <tbody>${linhas}</tbody>
            </table>`;
    }).join('');

    const html = `
        <!doctype html>
        <html lang="pt-BR">
        <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#1f2937;">
            <div style="max-width:760px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
                <h2 style="margin-top:0;color:#111827;">Resumo semanal de estágio</h2>
                <p>Resumo dos estudantes em estágio ativo nos últimos 7 dias:</p>
                ${tabelasPorSupervisor}
                <p style="margin-bottom:0;margin-top:24px;font-size:12px;color:#6b7280;">As horas mostram os registros não invalidados no período; atividades pendentes de validação estão incluídas.</p>
            </div>
        </body>
        </html>`;

    const texto = [
        'Resumo semanal de estágio — estudantes ativos dos últimos 7 dias:',
        ...supervisores.flatMap((supervisor) => [
            '',
            `Supervisor: ${supervisor.nome}`,
            ...supervisor.alunos.map((aluno) => `${aluno.aluno_nome}: ${Number(aluno.horas_semana).toFixed(2)} horas registradas; atividades preenchidas: ${Number(aluno.atividades_semana) > 0 ? `Sim (${aluno.atividades_semana})` : 'Não'} — ${urlAplicacao}/professor/aluno/${aluno.aluno_id}`),
        ]),
        '',
        'As horas incluem atividades pendentes de validação e excluem as invalidadas.',
    ].join('\n');

    return { html, texto };
}

function dataHoraBrasilia(agora = new Date()) {
    const partes = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(agora).reduce((resultado, parte) => {
        resultado[parte.type] = parte.value;
        return resultado;
    }, {});

    const data = `${partes.year}-${partes.month}-${partes.day}`;
    const diaSemana = new Date(`${data}T00:00:00Z`).getUTCDay();
    const diasDesdeSegunda = (diaSemana + 6) % 7;
    const inicioSemana = new Date(`${data}T00:00:00Z`);
    inicioSemana.setUTCDate(inicioSemana.getUTCDate() - diasDesdeSegunda);

    return {
        data,
        diaSemana,
        horario: `${partes.hour}:${partes.minute}`,
        semanaInicio: inicioSemana.toISOString().slice(0, 10),
    };
}

function jaDeuHorario(configuracao, agoraLocal) {
    const horarioConfigurado = String(configuracao.horario).slice(0, 5);
    const diaConfiguradoIso = (Number(configuracao.dia_semana) + 6) % 7;
    const diaAtualIso = (agoraLocal.diaSemana + 6) % 7;
    return diaAtualIso > diaConfiguradoIso
        || (diaAtualIso === diaConfiguradoIso && agoraLocal.horario >= horarioConfigurado);
}

async function executar({ forcar = false } = {}) {
    const client = await pool.connect();
    let lockAdquirido = false;
    try {
        const { rows: locks } = await client.query(
            'SELECT pg_try_advisory_lock(728341, 1) AS adquirido'
        );
        lockAdquirido = locks[0].adquirido;
        if (!lockAdquirido) {
            console.log('[relatorio-semanal] outra execução já está processando; encerrando.');
            return;
        }

        const { rows: configuracoes } = await client.query(`
            SELECT habilitado, dia_semana, TO_CHAR(horario, 'HH24:MI') AS horario,
                   ultimo_envio_semana
            FROM configuracoes_relatorio_semanal
            WHERE id = 1
        `);
        const configuracao = configuracoes[0];
        if (!configuracao) {
            throw new Error('Configuração do relatório não encontrada. Aplique a migração 011_relatorio_semanal_config.sql.');
        }
        if (!forcar && !configuracao.habilitado) {
            console.log('[relatorio-semanal] envio desabilitado pelo administrador.');
            return { enviado: false, motivo: 'desabilitado' };
        }

        const agoraLocal = dataHoraBrasilia();
        if (!forcar && !jaDeuHorario(configuracao, agoraLocal)) {
            return;
        }

        const ultimoEnvio = configuracao.ultimo_envio_semana instanceof Date
            ? configuracao.ultimo_envio_semana.toISOString().slice(0, 10)
            : String(configuracao.ultimo_envio_semana || '').slice(0, 10);
        if (!forcar && ultimoEnvio === agoraLocal.semanaInicio) {
            return { enviado: false, motivo: 'ja_enviado' };
        }

        const { rows } = await client.query(`
            SELECT
                supervisor.id AS supervisor_id,
                supervisor.nome AS supervisor_nome,
                supervisor.email AS supervisor_email,
                perfil_supervisor.receber_relatorio_semanal,
                aluno.usuario_id AS aluno_id,
                estudante.nome AS aluno_nome,
                COALESCE(SUM(atividade.horas) FILTER (
                    WHERE atividade.data >= $1::date - INTERVAL '6 days'
                      AND atividade.data < $1::date + INTERVAL '1 day'
                      AND atividade.status_validacao <> 'invalidada'
                ), 0) AS horas_semana,
                COUNT(atividade.id) FILTER (
                    WHERE atividade.data >= $1::date - INTERVAL '6 days'
                      AND atividade.data < $1::date + INTERVAL '1 day'
                )::int AS atividades_semana
            FROM alunos aluno
            JOIN usuarios estudante ON estudante.id = aluno.usuario_id
            JOIN usuarios supervisor ON supervisor.id = aluno.supervisor_id
            JOIN professores perfil_supervisor ON perfil_supervisor.usuario_id = supervisor.id
            LEFT JOIN atividades atividade ON atividade.aluno_id = aluno.usuario_id
            WHERE aluno.arquivado = false
              AND aluno.status = 'em_andamento'
              AND perfil_supervisor.receber_relatorio_semanal = true
            GROUP BY supervisor.id, supervisor.nome, supervisor.email,
                     perfil_supervisor.receber_relatorio_semanal, aluno.usuario_id, estudante.nome
            ORDER BY supervisor.nome, estudante.nome
        `, [agoraLocal.data]);

        const porSupervisor = new Map();
        for (const row of rows) {
            if (!porSupervisor.has(row.supervisor_id)) {
                porSupervisor.set(row.supervisor_id, {
                    id: row.supervisor_id,
                    nome: row.supervisor_nome,
                    email: row.supervisor_email,
                    alunos: [],
                });
            }
            porSupervisor.get(row.supervisor_id).alunos.push({
                aluno_id: row.aluno_id,
                aluno_nome: row.aluno_nome,
                horas_semana: row.horas_semana,
                atividades_semana: row.atividades_semana,
            });
        }

        let supervisores = [...porSupervisor.values()];
        if (supervisores.length === 0) {
            console.log('[relatorio-semanal] nenhum supervisor elegível para receber o resumo.');
            return { enviado: false, motivo: 'sem_destinatarios' };
        }

        if (!forcar) {
            const { rows: enviosAnteriores } = await client.query(
                `SELECT supervisor_id FROM envios_relatorios_semanais
                 WHERE semana_inicio = $1::date AND supervisor_id = ANY($2::integer[])`,
                [agoraLocal.semanaInicio, supervisores.map((supervisor) => supervisor.id)]
            );
            const idsJaNotificados = new Set(enviosAnteriores.map((envio) => envio.supervisor_id));
            supervisores = supervisores.filter((supervisor) => !idsJaNotificados.has(supervisor.id));
            if (supervisores.length === 0) {
                await client.query(
                    `UPDATE configuracoes_relatorio_semanal
                     SET ultimo_envio_semana = $1::date, atualizado_em = NOW()
                     WHERE id = 1`,
                    [agoraLocal.semanaInicio]
                );
                return { enviado: false, motivo: 'ja_enviado' };
            }
        }

        const { transporte, remetente, enderecoRemetente, urlAplicacao } = obterConfiguracaoEmail();
        const { html, texto } = montarEmail(supervisores, urlAplicacao);
        await transporte.sendMail({
            from: remetente,
            to: enderecoRemetente,
            bcc: supervisores.map((supervisor) => supervisor.email),
            subject: 'Resumo semanal de estágio dos estudantes',
            text: texto,
            html,
        });

        if (!forcar) {
            await client.query(
                `INSERT INTO envios_relatorios_semanais (semana_inicio, supervisor_id)
                 SELECT $1::date, supervisor_id
                 FROM UNNEST($2::integer[]) AS elegiveis(supervisor_id)
                 ON CONFLICT (semana_inicio, supervisor_id) DO NOTHING`,
                [agoraLocal.semanaInicio, supervisores.map((supervisor) => supervisor.id)]
            );
            await client.query(
                `UPDATE configuracoes_relatorio_semanal
                 SET ultimo_envio_semana = $1::date, atualizado_em = NOW()
                 WHERE id = 1`,
                [agoraLocal.semanaInicio]
            );
        }

        console.log(`[relatorio-semanal] email único enviado em ${forcar ? 'modo manual' : 'modo agendado'} para ${supervisores.length} supervisor(es) em BCC.`);
        return {
            enviado: true,
            destinatarios: supervisores.length,
            estudantes: supervisores.reduce((total, supervisor) => total + supervisor.alunos.length, 0),
        };
    } finally {
        if (lockAdquirido) {
            try {
                await client.query('SELECT pg_advisory_unlock(728341, 1)');
            } catch (erro) {
                console.error('[relatorio-semanal] não foi possível liberar o lock:', erro.message);
            }
        }
        client.release();
    }
}

if (require.main === module) {
    executar()
        .catch((erro) => {
            console.error('[relatorio-semanal] erro:', erro.message);
            process.exitCode = 1;
        })
        .finally(() => pool.end());
}

module.exports = { executar };
