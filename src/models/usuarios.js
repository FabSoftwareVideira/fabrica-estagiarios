const { pool } = require('../config/database');

async function buscarPorEmail(email) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    return rows[0] || null;
}

async function criar({ nome, email, tipo, senhaHash }) {
    const { rows } = await pool.query(
        `INSERT INTO usuarios (nome, email, tipo, senha_hash) VALUES ($1, $2, $3, $4) RETURNING *`,
        [nome, email, tipo, senhaHash]
    );
    return rows[0];
}

async function listarProfessores() {
    const { rows } = await pool.query(
        "SELECT id, nome, email FROM usuarios WHERE tipo = 'professor' ORDER BY nome"
    );
    return rows;
}

module.exports = { buscarPorEmail, criar, listarProfessores };
