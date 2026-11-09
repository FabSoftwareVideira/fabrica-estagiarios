const { pool } = require('../config/database');

async function listarPorAluno(alunoId) {
    const { rows } = await pool.query(
        `SELECT * FROM atividades WHERE aluno_id = $1 ORDER BY data DESC, id DESC`,
        [alunoId]
    );
    return rows;
}

async function buscarPorIdDoAluno(atividadeId, alunoId) {
    const { rows } = await pool.query(
        'SELECT * FROM atividades WHERE id = $1 AND aluno_id = $2',
        [atividadeId, alunoId]
    );
    return rows[0] || null;
}

async function ultimaPorAluno(alunoId) {
    const { rows } = await pool.query(
        `SELECT * FROM atividades WHERE aluno_id = $1 ORDER BY data DESC, id DESC LIMIT 1`,
        [alunoId]
    );
    return rows[0] || null;
}

async function criar({ alunoId, data, horaInicio, horaFim, horas, descricao }) {
    const { rows } = await pool.query(
        `INSERT INTO atividades (aluno_id, data, hora_inicio, hora_fim, horas, descricao) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [alunoId, data, horaInicio, horaFim, horas, descricao]
    );
    return rows[0];
}

// total de horas já registradas pelo aluno em um mesmo dia
async function somarHorasDoDia(alunoId, data, ignorarAtividadeId = null) {
    const { rows } = await pool.query(
        `SELECT COALESCE(SUM(horas), 0) AS total
         FROM atividades
         WHERE aluno_id = $1 AND data = $2 AND ($3::integer IS NULL OR id <> $3)`,
        [alunoId, data, ignorarAtividadeId]
    );
    return Number(rows[0].total);
}

async function atualizar({ atividadeId, alunoId, data, horaInicio, horaFim, horas, descricao }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: alunos } = await client.query(
            'SELECT status, arquivado, encerrado_em FROM alunos WHERE usuario_id = $1 FOR UPDATE',
            [alunoId]
        );
        if (!alunos.length || alunos[0].status !== 'em_andamento'
            || alunos[0].arquivado || alunos[0].encerrado_em) {
            await client.query('ROLLBACK');
            return { atividade: null, motivo: 'estagio_bloqueado' };
        }

        const { rows: atividades } = await client.query(
            `SELECT id FROM atividades WHERE id = $1 AND aluno_id = $2 FOR UPDATE`,
            [atividadeId, alunoId]
        );
        if (!atividades.length) {
            await client.query('ROLLBACK');
            return { atividade: null, motivo: 'nao_encontrada' };
        }

        const { rows: totais } = await client.query(
            `SELECT COALESCE(SUM(horas), 0) AS total
             FROM atividades
             WHERE aluno_id = $1 AND data = $2 AND id <> $3`,
            [alunoId, data, atividadeId]
        );
        if (Number(totais[0].total) + Number(horas) > 6) {
            await client.query('ROLLBACK');
            return { atividade: null, motivo: 'limite_diario' };
        }

        const { rows } = await client.query(
            `UPDATE atividades
             SET data = $3, hora_inicio = $4, hora_fim = $5, horas = $6, descricao = $7,
                 status_validacao = 'pendente', avaliado_por = NULL, avaliado_em = NULL
             WHERE id = $1 AND aluno_id = $2
             RETURNING *`,
            [atividadeId, alunoId, data, horaInicio, horaFim, horas, descricao]
        );
        await client.query('COMMIT');
        return { atividade: rows[0], motivo: null };
    } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
    } finally {
        client.release();
    }
}

async function excluir({ atividadeId, alunoId }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: alunos } = await client.query(
            'SELECT status, arquivado, encerrado_em FROM alunos WHERE usuario_id = $1 FOR UPDATE',
            [alunoId]
        );
        if (!alunos.length || alunos[0].status !== 'em_andamento'
            || alunos[0].arquivado || alunos[0].encerrado_em) {
            await client.query('ROLLBACK');
            return { atividade: null, motivo: 'estagio_bloqueado' };
        }

        const { rows: atividades } = await client.query(
            'DELETE FROM atividades WHERE id = $1 AND aluno_id = $2 RETURNING *',
            [atividadeId, alunoId]
        );
        if (!atividades.length) {
            await client.query('ROLLBACK');
            return { atividade: null, motivo: 'nao_encontrada' };
        }

        await client.query(
            `UPDATE alunos a
             SET status = CASE
                     WHEN a.status = 'lista_espera' THEN a.status
                     WHEN COALESCE((
                         SELECT SUM(horas) FROM atividades
                         WHERE aluno_id = a.usuario_id AND status_validacao = 'validada'
                     ), 0) >= a.carga_horaria THEN 'concluido'
                     ELSE 'em_andamento'
                 END
             WHERE a.usuario_id = $1`,
            [alunoId]
        );
        await client.query('COMMIT');
        return { atividade: atividades[0], motivo: null };
    } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
    } finally {
        client.release();
    }
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

        await client.query('SELECT usuario_id FROM alunos WHERE usuario_id = $1 FOR UPDATE', [alunoId]);
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

module.exports = {
    listarPorAluno,
    buscarPorIdDoAluno,
    ultimaPorAluno,
    criar,
    atualizar,
    excluir,
    definirValidacao,
    somarHorasDoDia,
};
