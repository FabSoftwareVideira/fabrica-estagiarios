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

// valida/desvalida uma atividade e recalcula o status do aluno na mesma
// transação: se as horas validadas atingirem a carga horária, conclui o estágio;
// se a validação for removida e as horas caírem, volta para "em_andamento".
async function definirValidacao({ atividadeId, alunoId, status, validadorId }) {
    const statusValidos = ['pendente', 'validada', 'invalidada'];
    if (!statusValidos.includes(status)) {
        throw new Error('Status de validação inválido.');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { rows: atividades } = await client.query(
            `UPDATE atividades
             SET status_validacao = $3::varchar,
                 avaliado_por = CASE WHEN $3::varchar = 'pendente' THEN NULL ELSE $4::integer END,
                 avaliado_em = CASE WHEN $3::varchar = 'pendente' THEN NULL ELSE NOW() END
             WHERE id = $1 AND aluno_id = $2
             RETURNING *`,
            [atividadeId, alunoId, status, validadorId]
        );

        if (atividades.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        const { rows: alunos } = await client.query(
            `UPDATE alunos a
             SET status = CASE
                     WHEN a.status = 'lista_espera' THEN a.status
                     WHEN COALESCE((
                         SELECT SUM(horas) FROM atividades
                         WHERE aluno_id = a.usuario_id AND status_validacao = 'validada'
                     ), 0) >= a.carga_horaria THEN 'concluido'
                     ELSE 'em_andamento'
                 END
             WHERE a.usuario_id = $1
             RETURNING a.status`,
            [alunoId]
        );

        await client.query('COMMIT');

        return {
            atividade: atividades[0],
            status: alunos[0] ? alunos[0].status : null,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { listarPorAluno, ultimaPorAluno, criar, definirValidacao };
