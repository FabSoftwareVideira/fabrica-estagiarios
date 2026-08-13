const { pool } = require('../config/database');

async function buscarPorUsuarioId(usuarioId) {
    const { rows } = await pool.query(
        `SELECT p.*, u.nome, u.email FROM professores p
         JOIN usuarios u ON u.id = p.usuario_id
         WHERE p.usuario_id = $1`,
        [usuarioId]
    );
    return rows[0] || null;
}

async function criar({ usuarioId, cargo = 'comum' }) {
    const { rows } = await pool.query(
        `INSERT INTO professores (usuario_id, cargo) VALUES ($1, $2) RETURNING *`,
        [usuarioId, cargo]
    );
    return rows[0];
}

// lista todos os professores, exceto o usuário logado (pra ninguém se
// autopromover/despromover ou se autoexcluir sem querer)
async function listarExceto(usuarioIdAtual) {
    const { rows } = await pool.query(
        `SELECT p.usuario_id, p.cargo, u.nome, u.email
         FROM professores p
         JOIN usuarios u ON u.id = p.usuario_id
         WHERE p.usuario_id != $1
         ORDER BY u.nome ASC`,
        [usuarioIdAtual]
    );
    return rows;
}

async function definirCargo(usuarioId, cargo) {
    await pool.query('UPDATE professores SET cargo = $2 WHERE usuario_id = $1', [usuarioId, cargo]);
}

async function excluir(usuarioId) {
    // apaga o usuário (o registro em "professores" some junto via ON DELETE CASCADE)
    await pool.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);
}

module.exports = { buscarPorUsuarioId, criar, listarExceto, definirCargo, excluir };
