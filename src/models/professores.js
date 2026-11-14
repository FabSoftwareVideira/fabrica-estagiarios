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

async function aprovarSupervisor(usuarioId) {
    const { rowCount } = await pool.query(
        `UPDATE professores SET aprovado = true
         WHERE usuario_id = $1 AND cargo = 'supervisor' AND aprovado = false`,
        [usuarioId]
    );
    return rowCount > 0;
}

// O que ainda depende da pessoa em cada papel. Um papel com vínculos em aberto
// não pode ser retirado antes de trocar os responsáveis.
async function contarVinculos(usuarioId) {
    const { rows } = await pool.query(
        `SELECT (SELECT COUNT(*) FROM alunos WHERE orientador_id = $1 AND encerrado_em IS NULL)::int AS orientandos,
                (SELECT COUNT(*) FROM alunos WHERE supervisor_id = $1 AND encerrado_em IS NULL)::int AS supervisionados,
                (SELECT COUNT(*) FROM bancas WHERE situacao IN ('agendada', 'remarcada')
                    AND $1 IN (orientador_id, avaliador_1_id, avaliador_2_id))::int AS bancas`,
        [usuarioId]
    );
    return rows[0];
}

// Grava o conjunto de papéis de uma conta interna. Não mexe em supervisor externo.
async function definirPapeis(usuarioId, { admin, servidor, orientador, supervisor }) {
    const { rowCount } = await pool.query(
        `UPDATE professores
         SET cargo = CASE WHEN $2 THEN 'admin' ELSE 'comum' END,
             papel_servidor = $3, papel_orientador = $4, papel_supervisor = $5
         WHERE usuario_id = $1 AND cargo <> 'supervisor'`,
        [usuarioId, Boolean(admin), Boolean(servidor), Boolean(orientador), Boolean(supervisor)]
    );
    return rowCount > 0;
}

// Empresa e função de um supervisor externo.
async function atualizarDadosExternos(usuarioId, empresa, funcao) {
    await pool.query(
        "UPDATE professores SET empresa_externa = $2, funcao_externa = $3 WHERE usuario_id = $1 AND cargo = 'supervisor'",
        [usuarioId, empresa, funcao]
    );
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

module.exports = {
    buscarPorUsuarioId,
    criar,
    solicitarAcessoSupervisor,
    aprovarSupervisor,
    definirCargo,
    contarVinculos,
    definirPapeis,
    atualizarDadosExternos,
    definirRecebimentoRelatorio,
};
