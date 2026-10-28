const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');
const BASELINE_THROUGH = 10;

function listarMigracoes() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter((arquivo) => /^\d{3}_.+\.sql$/.test(arquivo))
        .sort((a, b) => a.localeCompare(b));
}

async function schemaLegadoCompleto(client) {
    const { rows } = await client.query(`
        WITH colunas_obrigatorias (tabela, coluna) AS (
            VALUES
                ('usuarios', 'nome_confirmado'),
                ('usuarios', 'google_id'),
                ('usuarios', 'avatar_emoji'),
                ('alunos', 'empresa'),
                ('atividades', 'status_validacao'),
                ('atividades', 'hora_inicio'),
                ('atividades', 'hora_fim')
        )
        SELECT
            NOT EXISTS (
                SELECT 1
                FROM colunas_obrigatorias obrigatoria
                WHERE NOT EXISTS (
                    SELECT 1 FROM information_schema.columns coluna
                    WHERE coluna.table_schema = current_schema()
                      AND coluna.table_name = obrigatoria.tabela
                      AND coluna.column_name = obrigatoria.coluna
                )
            )
            AND EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'alunos'
                  AND column_name = 'matricula'
                  AND is_nullable = 'YES'
            )
            AND to_regclass('faas') IS NOT NULL
            AND to_regclass('fapos') IS NOT NULL
            AND to_regclass('professores') IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'atividades'
                  AND column_name = 'validado'
            ) AS completo
    `);
    return rows[0].completo;
}

async function registrarBaselineLegado(client, migracoes) {
    const { rows } = await client.query('SELECT COUNT(*)::int AS total FROM schema_migrations');
    if (rows[0].total > 0) return;

    if (!(await schemaLegadoCompleto(client))) {
        throw new Error(
            'Não foi possível identificar o schema legado como atualizado até a migração 010. ' +
            'Revise/aplique as migrações antigas antes de habilitar o deploy automático.'
        );
    }

    const baseline = migracoes.filter((arquivo) => Number(arquivo.slice(0, 3)) <= BASELINE_THROUGH);
    if (baseline.length > 0) {
        await client.query(
            `INSERT INTO schema_migrations (filename)
             SELECT unnest($1::text[])
             ON CONFLICT (filename) DO NOTHING`,
            [baseline]
        );
        console.log(`[migrations] schema legado reconhecido; baseline registrado até ${baseline[baseline.length - 1]}.`);
    }
}

async function executarMigracoes() {
    const client = await pool.connect();
    let lockAdquirido = false;

    try {
        await client.query('SELECT pg_advisory_lock(728341, 3)');
        lockAdquirido = true;

        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename   TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        const migracoes = listarMigracoes();
        await registrarBaselineLegado(client, migracoes);

        for (const filename of migracoes) {
            const { rowCount } = await client.query(
                'SELECT 1 FROM schema_migrations WHERE filename = $1',
                [filename]
            );
            if (rowCount > 0) continue;

            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query(
                    'INSERT INTO schema_migrations (filename) VALUES ($1)',
                    [filename]
                );
                await client.query('COMMIT');
                console.log(`[migrations] aplicada ${filename}`);
            } catch (erro) {
                await client.query('ROLLBACK');
                throw new Error(`Falha ao aplicar ${filename}: ${erro.message}`, { cause: erro });
            }
        }

        console.log('[migrations] todas as migrações pendentes foram aplicadas.');
    } finally {
        if (lockAdquirido) {
            try {
                await client.query('SELECT pg_advisory_unlock(728341, 3)');
            } catch (erro) {
                console.error('[migrations] não foi possível liberar o lock:', erro.message);
            }
        }
        client.release();
    }
}

if (require.main === module) {
    executarMigracoes()
        .catch((erro) => {
            console.error('[migrations] erro:', erro.message);
            process.exitCode = 1;
        })
        .finally(() => pool.end());
}

module.exports = { executarMigracoes };
