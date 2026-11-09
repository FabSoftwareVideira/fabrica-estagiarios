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

async function criar({ usuarioId, cargo = 'comum', aprovado = true }) {
    const { rows } = await pool.query(
        `INSERT INTO professores (usuario_id, cargo, aprovado, receber_relatorio_semanal)
         VALUES ($1, $2, $3, true)
         RETURNING *`,
        [usuarioId, cargo, aprovado]
    );
    return rows[0];
}

async function solicitarAcessoSupervisor(usuarioId, empresa, funcao) {
    const { rows } = await pool.query(
        `WITH candidato AS (
            UPDATE usuarios
            SET tipo = 'professor'
            WHERE id = $1 AND tipo = 'aluno'
              AND RIGHT(LOWER(email), LENGTH('@ifc.edu.br')) <> '@ifc.edu.br'
              AND NOT EXISTS (SELECT 1 FROM alunos WHERE usuario_id = $1)
            RETURNING id
        )
        INSERT INTO professores
            (usuario_id, cargo, aprovado, empresa_externa, funcao_externa, receber_relatorio_semanal)
        SELECT id, 'supervisor', false, $2, $3, false FROM candidato
        RETURNING usuario_id`,
        [usuarioId, empresa, funcao]
    );
    return rows.length > 0;
}

async function listarSupervisoresPendentes() {
    const { rows } = await pool.query(
        `SELECT p.usuario_id AS id, u.nome, u.email, p.empresa_externa, p.funcao_externa
         FROM professores p
         JOIN usuarios u ON u.id = p.usuario_id
         WHERE p.cargo = 'supervisor' AND p.aprovado = false
         ORDER BY u.nome`
    );
    return rows;
}

async function aprovarSupervisor(usuarioId) {
    const { rowCount } = await pool.query(
        `UPDATE professores SET aprovado = true
         WHERE usuario_id = $1 AND cargo = 'supervisor' AND aprovado = false`,
        [usuarioId]
    );
    return rowCount > 0;
}

// lista todos os professores, exceto o usuário logado (pra ninguém se
// autopromover/despromover ou se autoexcluir sem querer)
async function listarExceto(usuarioIdAtual) {
    const { rows } = await pool.query(
        `SELECT p.usuario_id, p.cargo, u.nome, u.email
         FROM professores p
         JOIN usuarios u ON u.id = p.usuario_id
         WHERE p.usuario_id != $1 AND p.cargo <> 'supervisor'
         ORDER BY u.nome ASC`,
        [usuarioIdAtual]
    );
    return rows;
}

async function definirCargo(usuarioId, cargo) {
    const { rowCount } = await pool.query(
        "UPDATE professores SET cargo = $2 WHERE usuario_id = $1 AND cargo <> 'supervisor'",
        [usuarioId, cargo]
    );
    return rowCount > 0;
}

async function definirRecebimentoRelatorio(usuarioId, receber) {
    await pool.query(
        'UPDATE professores SET receber_relatorio_semanal = $2 WHERE usuario_id = $1',
        [usuarioId, receber]
    );
}

async function excluir(usuarioId) {
    // apaga o usuário (o registro em "professores" some junto via ON DELETE CASCADE)
    await pool.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);
}

module.exports = {
    buscarPorUsuarioId,
    criar,
    solicitarAcessoSupervisor,
    listarSupervisoresPendentes,
    aprovarSupervisor,
    listarExceto,
    definirCargo,
    definirRecebimentoRelatorio,
    excluir,
};
