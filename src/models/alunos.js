const { pool } = require('../config/database');

async function buscarPorUsuarioId(usuarioId) {
    const { rows } = await pool.query(
        `SELECT a.*, u.nome, u.email,
                sup.nome AS supervisor_nome, ori.nome AS orientador_nome,
                COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id), 0) AS horas_realizadas
         FROM alunos a
         JOIN usuarios u ON u.id = a.usuario_id
         LEFT JOIN usuarios sup ON sup.id = a.supervisor_id
         LEFT JOIN usuarios ori ON ori.id = a.orientador_id
         WHERE a.usuario_id = $1`,
        [usuarioId]
    );
    return rows[0] || null;
}

async function criar({ usuarioId, matricula }) {
    const { rows } = await pool.query(
        `INSERT INTO alunos (usuario_id, matricula) VALUES ($1, $2) RETURNING *`,
        [usuarioId, matricula]
    );
    return rows[0];
}

// listas do dashboard nunca mostram quem está arquivado
async function listarPorStatus(status) {
    const { rows } = await pool.query(
        `SELECT a.*, u.nome, u.email,
                sup.nome AS supervisor_nome,
                COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id), 0) AS horas_realizadas
         FROM alunos a
         JOIN usuarios u ON u.id = a.usuario_id
         LEFT JOIN usuarios sup ON sup.id = a.supervisor_id
         WHERE a.status = $1 AND a.arquivado = false
         ORDER BY u.nome`,
        [status]
    );
    return rows;
}

async function contarPorStatus() {
    const { rows } = await pool.query(
        `SELECT status, COUNT(*)::int AS total FROM alunos WHERE arquivado = false GROUP BY status`
    );
    const contagem = { lista_espera: 0, em_andamento: 0, concluido: 0 };
    rows.forEach((r) => { contagem[r.status] = r.total; });
    contagem.total = contagem.lista_espera + contagem.em_andamento + contagem.concluido;
    return contagem;
}

async function atualizarEstagio(usuarioId, { status, supervisorId, orientadorId, cargaHoraria }) {
    const { rows } = await pool.query(
        `UPDATE alunos
         SET status = $2, supervisor_id = $3, orientador_id = $4, carga_horaria = $5
         WHERE usuario_id = $1
         RETURNING *`,
        [usuarioId, status, supervisorId || null, orientadorId || null, cargaHoraria]
    );
    return rows[0];
}

// só arquiva quem está na lista de espera ou em andamento
async function arquivar(usuarioId) {
    await pool.query(
        `UPDATE alunos SET arquivado = true
         WHERE usuario_id = $1 AND status IN ('lista_espera', 'em_andamento')`,
        [usuarioId]
    );
}

async function desarquivar(usuarioId) {
    await pool.query('UPDATE alunos SET arquivado = false WHERE usuario_id = $1', [usuarioId]);
}

async function listarArquivados(busca) {
    const termo = `%${(busca || '').trim()}%`;
    const { rows } = await pool.query(
        `SELECT a.*, u.nome, u.email,
                COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id), 0) AS horas_realizadas
         FROM alunos a
         JOIN usuarios u ON u.id = a.usuario_id
         WHERE a.arquivado = true
           AND (u.nome ILIKE $1 OR a.matricula ILIKE $1 OR u.email ILIKE $1)
         ORDER BY u.nome`,
        [termo]
    );
    return rows;
}

async function excluir(usuarioId) {
    // apaga o usuário (aluno + atividades somem junto via ON DELETE CASCADE)
    await pool.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);
}

module.exports = {
    buscarPorUsuarioId,
    criar,
    listarPorStatus,
    contarPorStatus,
    atualizarEstagio,
    arquivar,
    desarquivar,
    listarArquivados,
    excluir,
};
