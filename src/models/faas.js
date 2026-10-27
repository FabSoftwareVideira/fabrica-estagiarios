const { pool } = require('../config/database');

function normalizar(row) {
    if (!row) return null;

    return {
        ...row,
        notas: Array.isArray(row.notas) ? row.notas.map(Number) : [],
        respostas: Array.isArray(row.respostas) ? row.respostas.map(String) : [],
    };
}

async function buscarPorAluno(alunoId) {
    const { rows } = await pool.query(
        'SELECT * FROM faas WHERE aluno_id = $1',
        [alunoId]
    );
    return normalizar(rows[0]);
}

async function salvar({
    alunoId,
    empresa,
    periodo,
    notas,
    atividades,
    respostas,
    comentarios,
    dataAssinatura,
}) {
    const { rows } = await pool.query(
        `INSERT INTO faas (
             aluno_id, empresa, periodo, notas, atividades,
             respostas, comentarios, data_assinatura
         )
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8)
         ON CONFLICT (aluno_id) DO UPDATE SET
             empresa = EXCLUDED.empresa,
             periodo = EXCLUDED.periodo,
             notas = EXCLUDED.notas,
             atividades = EXCLUDED.atividades,
             respostas = EXCLUDED.respostas,
             comentarios = EXCLUDED.comentarios,
             data_assinatura = EXCLUDED.data_assinatura,
             atualizado_em = NOW()
         RETURNING *`,
        [
            alunoId,
            empresa,
            periodo,
            JSON.stringify(notas),
            atividades,
            JSON.stringify(respostas),
            comentarios,
            dataAssinatura,
        ]
    );

    return normalizar(rows[0]);
}

module.exports = { buscarPorAluno, salvar };
