const { pool } = require('../config/database');

function normalizar(row) {
    if (!row) return null;
    return {
        ...row,
        nota: Number(row.nota),
    };
}

async function buscarPorAluno(alunoId) {
    const { rows } = await pool.query(
        'SELECT * FROM fapos WHERE aluno_id = $1',
        [alunoId]
    );
    return normalizar(rows[0]);
}

async function salvar({ alunoId, nota, comentarios, dataAssinatura }) {
    const { rows } = await pool.query(
        `INSERT INTO fapos (aluno_id, nota, comentarios, data_assinatura)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (aluno_id) DO UPDATE SET
             nota = EXCLUDED.nota,
             comentarios = EXCLUDED.comentarios,
             data_assinatura = EXCLUDED.data_assinatura,
             atualizado_em = NOW()
         RETURNING *`,
        [alunoId, nota, comentarios, dataAssinatura]
    );
    return normalizar(rows[0]);
}

module.exports = { buscarPorAluno, salvar };
