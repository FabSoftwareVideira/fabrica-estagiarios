const { pool } = require('../config/database');

async function buscarPorEmail(email) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    return rows[0] || null;
}

async function buscarPorGithubId(githubId) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE github_id = $1', [githubId]);
    return rows[0] || null;
}

async function buscarPorGoogleId(googleId) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE google_id = $1', [googleId]);
    return rows[0] || null;
}

async function buscarPorId(id) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    return rows[0] || null;
}

async function criar({ nome, email, tipo, githubId, googleId, avatarUrl, nomeConfirmado = false }) {
    const { rows } = await pool.query(
        `INSERT INTO usuarios (nome, email, tipo, github_id, google_id, avatar_url, nome_confirmado)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [nome, email, tipo, githubId, googleId, avatarUrl, nomeConfirmado]
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

async function vincularGoogleId(usuarioId, googleId, avatarUrl) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET google_id = $2, avatar_url = $3 WHERE id = $1 RETURNING *`,
        [usuarioId, googleId, avatarUrl]
    );
    return rows[0];
}

async function listarProfessores() {
    const { rows } = await pool.query(
        "SELECT id, nome, email FROM usuarios WHERE tipo = 'professor' ORDER BY nome"
    );
    return rows;
}

// o GitHub às vezes só devolve o primeiro nome (ou o "login") no perfil,
// então pedimos confirmação/edição do nome completo no primeiro acesso —
// tanto pra aluno (junto da matrícula) quanto pra professor (tela própria)
async function confirmarNome(usuarioId, nome) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET nome = $2, nome_confirmado = true WHERE id = $1 RETURNING *`,
        [usuarioId, nome]
    );
    return rows[0];
}

async function atualizarPerfil(usuarioId, nome) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET nome = $2, nome_confirmado = true WHERE id = $1 RETURNING *`,
        [usuarioId, nome]
    );
    return rows[0];
}

module.exports = {
    buscarPorEmail,
    buscarPorGithubId,
    buscarPorGoogleId,
    buscarPorId,
    criar,
    vincularGithubId,
    vincularGoogleId,
    listarProfessores,
    confirmarNome,
    atualizarPerfil,
};
