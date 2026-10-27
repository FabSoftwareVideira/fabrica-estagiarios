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

async function buscarPorMatricula(matricula) {
    const { rows } = await pool.query('SELECT * FROM alunos WHERE matricula = $1', [matricula]);
    return rows[0] || null;
}

async function atualizarMatricula(usuarioId, matricula) {
    const { rows } = await pool.query(
        `UPDATE alunos SET matricula = $2 WHERE usuario_id = $1 RETURNING *`,
        [usuarioId, matricula]
    );
    return rows[0];
}

// tabela única do dashboard: todos os status, com busca, status e arquivados
async function listar({ status, busca, arquivados, limite, offset }) {
    const valores = [Boolean(arquivados)];
    const filtros = ['a.arquivado = $1'];

    if (status && status !== 'todos') {
        valores.push(status);
        filtros.push(`a.status = $${valores.length}`);
    }

    const termo = (busca || '').trim();
    if (termo) {
        valores.push(`%${termo}%`);
        filtros.push(`(u.nome ILIKE $${valores.length} OR a.matricula ILIKE $${valores.length} OR u.email ILIKE $${valores.length})`);
    }

    const where = `WHERE ${filtros.join(' AND ')}`;

    const { rows: contagemRows } = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM alunos a
         JOIN usuarios u ON u.id = a.usuario_id
         ${where}`,
        valores
    );

    const valoresPagina = [...valores, limite, offset];
    const { rows } = await pool.query(
        `SELECT a.*, u.nome, u.email,
                sup.nome AS supervisor_nome,
                ori.nome AS orientador_nome,
                COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id), 0) AS horas_realizadas
         FROM alunos a
         JOIN usuarios u ON u.id = a.usuario_id
         LEFT JOIN usuarios sup ON sup.id = a.supervisor_id
         LEFT JOIN usuarios ori ON ori.id = a.orientador_id
         ${where}
         ORDER BY CASE a.status
                    WHEN 'lista_espera' THEN 1
                    WHEN 'em_andamento' THEN 2
                    ELSE 3
                  END,
                  u.nome
         LIMIT $${valoresPagina.length - 1} OFFSET $${valoresPagina.length}`,
        valoresPagina
    );

    return { alunos: rows, total: contagemRows[0].total };
}

async function contarPorStatus() {
    const { rows } = await pool.query(
        `SELECT status, arquivado, COUNT(*)::int AS total FROM alunos GROUP BY status, arquivado`
    );
    const contagem = { lista_espera: 0, em_andamento: 0, concluido: 0, arquivados: 0, total: 0 };
    rows.forEach((r) => {
        if (r.arquivado) {
            contagem.arquivados += r.total;
        } else {
            contagem[r.status] = r.total;
            contagem.total += r.total;
        }
    });
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

async function excluir(usuarioId) {
    // apaga o usuário (aluno + atividades somem junto via ON DELETE CASCADE)
    await pool.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);
}

module.exports = {
    buscarPorUsuarioId,
    criar,
    buscarPorMatricula,
    atualizarMatricula,
    listar,
    contarPorStatus,
    atualizarEstagio,
    arquivar,
    desarquivar,
    excluir,
};
