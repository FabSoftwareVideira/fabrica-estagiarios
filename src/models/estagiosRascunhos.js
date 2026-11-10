// Rascunhos do fluxo "Incluir estágio" (setor de estágios).
const { pool } = require('../config/database');

// Lista com o nome do estagiário: o escolhido na lista de espera ou o digitado.
async function listar() {
    const { rows } = await pool.query(
        `SELECT r.id, r.dados, r.atualizado_em,
                COALESCE(NULLIF(u.nome, ''), NULLIF(r.dados->>'nome', '')) AS estagiario,
                autor.nome AS atualizado_por_nome
         FROM estagios_rascunhos r
         LEFT JOIN usuarios u ON r.dados->>'modo' = 'existente'
              AND u.id = CASE WHEN r.dados->>'aluno_id' ~ '^[0-9]+$' THEN (r.dados->>'aluno_id')::int END
         LEFT JOIN usuarios autor ON autor.id = r.atualizado_por
         ORDER BY r.atualizado_em DESC`
    );
    return rows;
}

async function buscar(id) {
    const { rows } = await pool.query('SELECT * FROM estagios_rascunhos WHERE id = $1', [id]);
    return rows[0] || null;
}

// Cria (sem id) ou atualiza um rascunho. Devolve o id, ou null se o rascunho não existe mais.
async function salvar(id, usuarioId, dados) {
    if (id) {
        const { rows } = await pool.query(
            `UPDATE estagios_rascunhos SET dados = $2::jsonb, atualizado_por = $3, atualizado_em = NOW()
             WHERE id = $1 RETURNING id`,
            [id, JSON.stringify(dados), usuarioId]
        );
        return rows[0] ? rows[0].id : null;
    }
    const { rows } = await pool.query(
        `INSERT INTO estagios_rascunhos (dados, criado_por, atualizado_por) VALUES ($1::jsonb, $2, $2) RETURNING id`,
        [JSON.stringify(dados), usuarioId]
    );
    return rows[0].id;
}

async function excluir(id) {
    const { rowCount } = await pool.query('DELETE FROM estagios_rascunhos WHERE id = $1', [id]);
    return rowCount > 0;
}

// Estudantes que se cadastraram e ainda aguardam a definição do estágio.
async function listarEstudantesEmEspera() {
    const { rows } = await pool.query(
        `SELECT a.usuario_id AS id, u.nome, u.email, a.curso, a.matricula
         FROM alunos a JOIN usuarios u ON u.id = a.usuario_id
         WHERE a.status = 'lista_espera' AND a.arquivado = false AND u.ativo = true
         ORDER BY u.nome`
    );
    return rows;
}

module.exports = { listar, buscar, salvar, excluir, listarEstudantesEmEspera };
