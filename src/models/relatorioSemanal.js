const { pool } = require('../config/database');

async function buscarConfiguracao() {
    const { rows } = await pool.query(
        `SELECT habilitado, dia_semana, TO_CHAR(horario, 'HH24:MI') AS horario,
                ultimo_envio_semana, atualizado_em
         FROM configuracoes_relatorio_semanal
         WHERE id = 1`
    );
    return rows[0] || null;
}

async function salvarConfiguracao({ habilitado, diaSemana, horario }) {
    const { rows } = await pool.query(
        `UPDATE configuracoes_relatorio_semanal
         SET habilitado = $1,
             dia_semana = $2,
             horario = $3::time,
             atualizado_em = NOW()
         WHERE id = 1
         RETURNING habilitado, dia_semana, TO_CHAR(horario, 'HH24:MI') AS horario,
                   ultimo_envio_semana, atualizado_em`,
        [habilitado, diaSemana, horario]
    );
    return rows[0] || null;
}

async function listarDestinatarios() {
    const { rows } = await pool.query(
        `SELECT supervisor.id, supervisor.nome, supervisor.email,
                perfil_supervisor.receber_relatorio_semanal,
                COUNT(aluno.usuario_id)::int AS quantidade_alunos
         FROM alunos aluno
         JOIN usuarios supervisor ON supervisor.id = aluno.supervisor_id
         JOIN professores perfil_supervisor ON perfil_supervisor.usuario_id = supervisor.id
         WHERE aluno.arquivado = false
           AND aluno.status = 'em_andamento'
         GROUP BY supervisor.id, supervisor.nome, supervisor.email,
                  perfil_supervisor.receber_relatorio_semanal
         ORDER BY supervisor.nome ASC`
    );
    return rows;
}

module.exports = { buscarConfiguracao, salvarConfiguracao, listarDestinatarios };
