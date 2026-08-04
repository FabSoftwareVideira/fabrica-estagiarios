const { pool } = require('../config/database');

async function listarPorAluno(alunoId) {
    const { rows } = await pool.query(
        `SELECT * FROM atividades WHERE aluno_id = $1 ORDER BY data DESC, id DESC`,
        [alunoId]
    );
    return rows;
}

async function ultimaPorAluno(alunoId) {
    const { rows } = await pool.query(
        `SELECT * FROM atividades WHERE aluno_id = $1 ORDER BY data DESC, id DESC LIMIT 1`,
        [alunoId]
    );
    return rows[0] || null;
}

async function criar({ alunoId, data, horas, descricao }) {
    const { rows } = await pool.query(
        `INSERT INTO atividades (aluno_id, data, horas, descricao) VALUES ($1, $2, $3, $4) RETURNING *`,
        [alunoId, data, horas, descricao]
    );
    return rows[0];
}

module.exports = { listarPorAluno, ultimaPorAluno, criar };
