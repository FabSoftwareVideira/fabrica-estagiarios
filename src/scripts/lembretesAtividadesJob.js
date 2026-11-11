const { pool } = require('../config/database');
const { obterConfiguracaoEmail } = require('../services/email');
const { executar, contarElegiveis } = require('./enviarLembretesAtividades');

async function verificarBanco(banco = pool) {
    // Consulte o catálogo antes de acessar o schema: banco antigo recebe uma
    // instrução de migração, em vez de falhar no meio do processamento.
    const { rows } = await banco.query(`
        WITH necessarias(tabela, coluna) AS (VALUES
            ('alunos', 'relatorio_atualizado_em'), ('alunos', 'arquivado'),
            ('alunos', 'encerrado_em'), ('usuarios', 'ativo'),
            ('usuarios', 'receber_lembretes_atividades'),
            ('lembretes_atividades', 'aluno_id'), ('lembretes_atividades', 'enviado_em'),
            ('lembretes_atividades', 'proximo_envio_em')
        )
        SELECT tabela || '.' || coluna AS ausente FROM necessarias n
        WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = current_schema() AND c.table_name = n.tabela AND c.column_name = n.coluna)
        UNION ALL
        SELECT 'trigger ' || nome AS ausente FROM (VALUES
            ('atividades', 'atividades_atualizam_relatorio'),
            ('alunos', 'alunos_iniciam_prazo_relatorio')
        ) AS exigidos(tabela, nome)
        WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = current_schema() AND c.relname = exigidos.tabela
                AND t.tgname = exigidos.nome AND t.tgenabled IN ('O', 'A'))`);
    if (rows.length) {
        throw new Error(`Banco não preparado para lembretes: ${rows.map((r) => r.ausente).join(', ')}. ` +
            'Implante a versão atual e execute src/scripts/runMigrations.js (incluindo 016, 021 e 025).');
    }
}

async function executarJob({ modo = 'diagnostico', banco = pool,
    configurarEmail = obterConfiguracaoEmail, logger = console } = {}) {
    if (!['diagnostico', 'simular', 'enviar'].includes(modo)) {
        throw new Error('Modo inválido. Use --diagnostico, --simular ou --enviar.');
    }
    await verificarBanco(banco);
    logger.log('[lembretes] Banco e registro de atualizações disponíveis.');
    const elegiveis = await contarElegiveis(banco);
    logger.log(`[lembretes] ${elegiveis} estudante(s) elegível(is) neste momento.`);

    if (modo === 'simular') {
        logger.log('[lembretes] Simulação concluída: nenhum e-mail enviado e nenhum prazo alterado.');
        return { modo, elegiveis };
    }
    if (modo === 'enviar') {
        // O envio reconsulta e revalida os candidatos sob advisory lock.
        return executar({ banco, configurarEmail, logger });
    }

    const config = configurarEmail();
    try {
        await config.transporte.verify();
        logger.log('[lembretes] SMTP conectado e autenticado. Nenhum e-mail enviado. ' +
            'A aceitação do remetente e a entrega só podem ser confirmadas com um envio real.');
        return { modo, elegiveis, smtp: true };
    } finally {
        config.transporte.close?.();
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const modo = args.length === 0 ? 'diagnostico'
        : args.length === 1 && /^--(diagnostico|simular|enviar)$/.test(args[0]) ? args[0].slice(2) : 'invalido';
    executarJob({ modo }).then((r) => { if (r.falhas) process.exitCode = 1; })
        .catch((erro) => { console.error('[lembretes]', erro.message); process.exitCode = 1; })
        .finally(() => pool.end());
}

module.exports = { executarJob, verificarBanco };
