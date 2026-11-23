const { pool } = require('../config/database');
const { comEstagioAtual } = require('../utils/versaoEstagio');

async function buscar(alunoId, tipo) {
    const { rows } = await pool.query(
        'SELECT dados, atualizado_em FROM fichas_rascunhos WHERE aluno_id = $1 AND tipo = $2',
        [alunoId, tipo]
    );
    return rows[0] || null;
}

async function salvar(alunoId, tipo, dados, contexto) {
    const { rows } = await comEstagioAtual(alunoId, contexto, (banco) => banco.query(
        `INSERT INTO fichas_rascunhos (aluno_id, tipo, dados)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (aluno_id, tipo) DO UPDATE SET
             dados = EXCLUDED.dados,
             atualizado_em = NOW()
         RETURNING dados, atualizado_em`,
        [alunoId, tipo, JSON.stringify(dados)]
    ));
    return rows[0];
}

module.exports = { buscar, salvar };
