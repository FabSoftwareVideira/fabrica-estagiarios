const { pool } = require('../config/database');
const { obterConfiguracaoEmail, escaparHtml } = require('../services/email');

const ELEGIVEL = `a.status = 'em_andamento' AND a.arquivado = false
    AND a.encerrado_em IS NULL
    AND a.relatorio_atualizado_em < NOW() - INTERVAL '5 days'
    AND (l.proximo_envio_em IS NULL OR l.proximo_envio_em <= NOW())
    AND EXISTS (SELECT 1 FROM usuarios pref WHERE pref.id = a.usuario_id
        AND pref.ativo = true AND pref.tipo = 'aluno' AND pref.receber_lembretes_atividades = true)`;

async function contarElegiveis(banco = pool) {
    const { rows } = await banco.query(`SELECT COUNT(*)::int AS total FROM alunos a
        LEFT JOIN lembretes_atividades l ON l.aluno_id = a.usuario_id WHERE ${ELEGIVEL}`);
    return rows[0].total;
}

function montarEmail(aluno, urlAplicacao) {
    const link = `${urlAplicacao}/aluno/nova-atividade`;
    const detalhes = [
        ['Estudante', aluno.nome], ['Matrícula', aluno.matricula],
        ['Empresa', aluno.empresa], ['Supervisor', aluno.supervisor_nome],
        ['Orientador', aluno.orientador_nome], ['Carga horária', `${aluno.carga_horaria} horas`],
    ].filter(([, valor]) => valor);
    const pedido = 'Seu relatório de estágio está há mais de 5 dias sem novos registros ou atualizações. Registre as atividades semanais e as horas realizadas para manter seu acompanhamento em dia.';
    return {
        texto: [`Olá, ${aluno.nome}!`, '', pedido, '', ...detalhes.map(([k, v]) => `${k}: ${v}`),
            '', `Registrar atividades: ${link}`, 'Entre com sua conta de estudante para atualizar o relatório.',
            'Se o relatório continuar sem atualização, um novo lembrete poderá ser enviado após 7 dias.'].join('\n'),
        html: `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#1f2937;">
            <div style="max-width:640px;margin:auto;padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
            <h2>Atualize seu relatório de estágio</h2><p>Olá, ${escaparHtml(aluno.nome)}!</p><p>${pedido}</p>
            <dl>${detalhes.map(([k, v]) => `<dt style="font-weight:bold;">${k}</dt><dd style="margin:0 0 12px;">${escaparHtml(v)}</dd>`).join('')}</dl>
            <p><a href="${escaparHtml(link)}" style="color:#1351b4;">Registrar atividades e horas</a></p>
            <p>Entre com sua conta de estudante para atualizar o relatório.</p>
            <p style="font-size:12px;">Se o relatório continuar sem atualização, um novo lembrete poderá ser enviado após 7 dias.</p>
            </div></body></html>`,
    };
}

async function executar({ banco = pool, configurarEmail = obterConfiguracaoEmail, logger = console } = {}) {
    const client = await banco.connect();
    let lock = false;
    let transporte;
    const resultado = { enviados: 0, falhas: 0 };
    try {
        const { rows } = await client.query('SELECT pg_try_advisory_lock(728341, 2) AS adquirido');
        lock = rows[0].adquirido;
        if (!lock) return { ...resultado, motivo: 'em_execucao' };

        const { rows: alunos } = await client.query(`SELECT a.usuario_id AS aluno_id,
            a.matricula, a.empresa, a.carga_horaria, u.nome, u.email,
            sup.nome AS supervisor_nome, ori.nome AS orientador_nome
            FROM alunos a JOIN usuarios u ON u.id = a.usuario_id
            LEFT JOIN usuarios sup ON sup.id = a.supervisor_id
            LEFT JOIN usuarios ori ON ori.id = a.orientador_id
            LEFT JOIN lembretes_atividades l ON l.aluno_id = a.usuario_id
            WHERE ${ELEGIVEL} ORDER BY a.usuario_id`);
        if (!alunos.length) return resultado;
        const config = configurarEmail();
        transporte = config.transporte;
        for (const aluno of alunos) {
            // Revalida antes de enviar e reserva o intervalo antes do SMTP:
            // um crash depois da aceitação não produz outro envio na próxima execução.
            const reserva = await client.query(`INSERT INTO lembretes_atividades (aluno_id, proximo_envio_em)
                SELECT a.usuario_id, NOW() + INTERVAL '7 days' FROM alunos a
                LEFT JOIN lembretes_atividades l ON l.aluno_id = a.usuario_id
                WHERE a.usuario_id = $1 AND ${ELEGIVEL}
                ON CONFLICT (aluno_id) DO UPDATE SET proximo_envio_em = EXCLUDED.proximo_envio_em
                RETURNING aluno_id`, [aluno.aluno_id]);
            if (!reserva.rowCount) continue;
            const { html, texto } = montarEmail(aluno, config.urlAplicacao);
            try {
                const info = await transporte.sendMail({ from: config.remetente,
                    to: { name: aluno.nome, address: aluno.email },
                    subject: 'Lembrete: registre suas atividades e horas de estágio', text: texto, html });
                if (info.rejected?.length) throw new Error('Destinatário recusado pelo SMTP.');
            } catch (erro) {
                resultado.falhas++;
                // Falha de SMTP: nova tentativa somente após uma hora.
                await client.query(`UPDATE lembretes_atividades
                    SET proximo_envio_em = NOW() + INTERVAL '1 hour' WHERE aluno_id = $1`, [aluno.aluno_id]);
                logger.error(`[lembretes-atividades] falha para aluno ${aluno.aluno_id}: ${erro.message}`);
                continue;
            }
            await client.query('UPDATE lembretes_atividades SET enviado_em = NOW() WHERE aluno_id = $1', [aluno.aluno_id]);
            resultado.enviados++;
        }
        logger.log(`[lembretes-atividades] ${resultado.enviados} enviado(s), ${resultado.falhas} falha(s).`);
        return resultado;
    } finally {
        transporte?.close?.();
        try {
            if (lock) await client.query('SELECT pg_advisory_unlock(728341, 2)');
        } finally {
            client.release();
        }
    }
}

if (require.main === module) {
    executar().then((r) => { if (r.falhas) process.exitCode = 1; })
        .catch((erro) => { console.error('[lembretes-atividades]', erro.message); process.exitCode = 1; })
        .finally(() => pool.end());
}
module.exports = { executar, montarEmail, contarElegiveis };
