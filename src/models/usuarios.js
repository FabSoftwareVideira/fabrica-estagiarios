const { pool } = require('../config/database');

async function buscarPorEmail(email) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    return rows[0] || null;
}

async function buscarPorGithubId(githubId) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE github_id = $1', [githubId]);
    return rows[0] || null;
}

async function criar({ nome, email, tipo, githubId, avatarUrl }) {
    const { rows } = await pool.query(
        `INSERT INTO usuarios (nome, email, tipo, github_id, avatar_url) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [nome, email, tipo, githubId, avatarUrl]
    );
    return rows[0];
}

// casa uma conta que já existia (ex.: seed do admin, sem github_id ainda)
// com o github_id assim que a pessoa loga pela primeira vez
async function vincularGithubId(usuarioId, githubId, avatarUrl) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET github_id = $2, avatar_url = $3 WHERE id = $1 RETURNING *`,
        [usuarioId, githubId, avatarUrl]
    );
    return rows[0];
}

async function listarProfessores() {
    const { rows } = await pool.query(
        "SELECT id, nome, email FROM usuarios WHERE tipo = 'professor' ORDER BY nome"
    );
    return rows;
}

module.exports = { buscarPorEmail, buscarPorGithubId, criar, vincularGithubId, listarProfessores };
