const { pool } = require('../config/database');
const { mediaFac } = require('../utils/fac');

async function buscarPorAluno(alunoId) {
    const { rows } = await pool.query('SELECT * FROM facs WHERE aluno_id = $1', [alunoId]);
    return rows[0] ? { ...rows[0], nota: mediaFac(rows[0].notas) } : null;
}

async function salvar(alunoId, supervisor, dados) {
    // Também protege contra encerramento/troca de supervisor enquanto o formulário está aberto.
    const { rows } = await pool.query(`WITH saved AS (INSERT INTO facs
        (aluno_id, supervisor_id, supervisor_nome, empresa, curso, periodo, notas,
         atividades, comentarios, local_assinatura, data_assinatura)
        SELECT usuario_id, $2, $3, $4, curso, $6, $7::jsonb, $8, $9, $10, $11::date
        FROM alunos WHERE usuario_id = $1 AND supervisor_id = $2 AND curso = $5
          AND status = 'concluido' AND encerrado_em IS NULL AND arquivado = false
        ON CONFLICT (aluno_id) DO UPDATE SET
          supervisor_id = EXCLUDED.supervisor_id, supervisor_nome = EXCLUDED.supervisor_nome,
          empresa = EXCLUDED.empresa, curso = EXCLUDED.curso, periodo = EXCLUDED.periodo,
          notas = EXCLUDED.notas, atividades = EXCLUDED.atividades, comentarios = EXCLUDED.comentarios,
          local_assinatura = EXCLUDED.local_assinatura, data_assinatura = EXCLUDED.data_assinatura,
          atualizado_em = NOW()
        RETURNING aluno_id
    ), removido AS (
        DELETE FROM fichas_rascunhos
        WHERE aluno_id IN (SELECT aluno_id FROM saved) AND tipo = 'FAC'
    )
    SELECT aluno_id FROM saved`,
    [alunoId, supervisor.id, supervisor.nome, dados.empresa, dados.curso, dados.periodo,
        JSON.stringify(dados.notas), dados.atividades, dados.comentarios, dados.local_assinatura, dados.data_assinatura]);
    return rows.length > 0;
}

async function listarPorSupervisor(supervisorId) {
    const { rows } = await pool.query(`SELECT a.usuario_id, a.status, a.encerrado_em, u.nome,
        a.empresa, f.aluno_id IS NOT NULL AS tem_fac
        FROM alunos a JOIN usuarios u ON u.id = a.usuario_id
        LEFT JOIN facs f ON f.aluno_id = a.usuario_id
        WHERE a.supervisor_id = $1 AND a.arquivado = false AND a.status <> 'lista_espera'
        ORDER BY u.nome`, [supervisorId]);
    return rows;
}
module.exports = { buscarPorAluno, salvar, listarPorSupervisor };
