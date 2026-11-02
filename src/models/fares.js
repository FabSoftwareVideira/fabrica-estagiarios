const { pool } = require('../config/database');
const { dataParaInput } = require('../utils/datas');

const BANCA_VAZIA = [[null, null, null], [null, null, null], [null, null, null]];

function numeroOuNull(valor) {
    return valor === null || valor === undefined ? null : Number(valor);
}

function normalizar(row) {
    if (!row) return null;

    const banca = Array.isArray(row.banca) ? row.banca : BANCA_VAZIA;

    return {
        ...row,
        nota_fac: numeroOuNull(row.nota_fac),
        nota_faa_manual: numeroOuNull(row.nota_faa_manual),
        banca: [0, 1, 2].map((i) => [0, 1, 2].map((j) => numeroOuNull((banca[i] || [])[j]))),
        corrigir_relatorio_ate: dataParaInput(row.corrigir_relatorio_ate),
        refazer_apresentacao_ate: dataParaInput(row.refazer_apresentacao_ate),
        data_ata: dataParaInput(row.data_ata),
    };
}

async function buscarPorAluno(alunoId) {
    const { rows } = await pool.query('SELECT * FROM fares WHERE aluno_id = $1', [alunoId]);
    return normalizar(rows[0]);
}

async function salvar({
    alunoId,
    periodo,
    notaFac,
    notaFaaManual,
    banca,
    avaliador1,
    avaliador2,
    resultado,
    corrigirRelatorioAte,
    refazerApresentacaoAte,
    comentarios,
    dataAta,
}) {
    const { rows } = await pool.query(
        `INSERT INTO fares (
             aluno_id, periodo, nota_fac, nota_faa_manual, banca, avaliador_1, avaliador_2,
             resultado, corrigir_relatorio_ate, refazer_apresentacao_ate, comentarios, data_ata
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (aluno_id) DO UPDATE SET
             periodo = EXCLUDED.periodo,
             nota_fac = EXCLUDED.nota_fac,
             nota_faa_manual = EXCLUDED.nota_faa_manual,
             banca = EXCLUDED.banca,
             avaliador_1 = EXCLUDED.avaliador_1,
             avaliador_2 = EXCLUDED.avaliador_2,
             resultado = EXCLUDED.resultado,
             corrigir_relatorio_ate = EXCLUDED.corrigir_relatorio_ate,
             refazer_apresentacao_ate = EXCLUDED.refazer_apresentacao_ate,
             comentarios = EXCLUDED.comentarios,
             data_ata = EXCLUDED.data_ata,
             atualizado_em = NOW()
         RETURNING *`,
        [
            alunoId,
            periodo,
            notaFac,
            notaFaaManual,
            JSON.stringify(banca),
            avaliador1,
            avaliador2,
            resultado,
            corrigirRelatorioAte || null,
            refazerApresentacaoAte || null,
            comentarios,
            dataAta || null,
        ]
    );
    return normalizar(rows[0]);
}

// encerra o estágio: só funciona para quem já cumpriu as horas
async function encerrar(alunoId) {
    const { rows } = await pool.query(
        `UPDATE alunos
         SET encerrado_em = NOW()
         WHERE usuario_id = $1 AND status = 'concluido' AND encerrado_em IS NULL
         RETURNING encerrado_em`,
        [alunoId]
    );
    return rows[0] || null;
}

async function reabrir(alunoId) {
    const { rowCount } = await pool.query(
        `UPDATE alunos SET encerrado_em = NULL WHERE usuario_id = $1 AND encerrado_em IS NOT NULL`,
        [alunoId]
    );
    return rowCount > 0;
}

// painel "Fichas" do orientador: todos os orientandos ativos, com o andamento
// de cada ficha (FAA do aluno, FAPO e ata do orientador)
async function listarPorOrientador(orientadorId) {
    const { rows } = await pool.query(
        `SELECT a.usuario_id, a.status, a.empresa, a.carga_horaria, a.encerrado_em,
                u.nome, a.matricula,
                COALESCE((SELECT SUM(horas) FROM atividades
                          WHERE aluno_id = a.usuario_id AND status_validacao = 'validada'), 0) AS horas_realizadas,
                (f.aluno_id IS NOT NULL) AS tem_faa,
                (p.aluno_id IS NOT NULL) AS tem_fapo,
                (r.aluno_id IS NOT NULL) AS tem_ata,
                r.resultado
         FROM alunos a
         JOIN usuarios u ON u.id = a.usuario_id
         LEFT JOIN faas f ON f.aluno_id = a.usuario_id
         LEFT JOIN fapos p ON p.aluno_id = a.usuario_id
         LEFT JOIN fares r ON r.aluno_id = a.usuario_id
         WHERE a.orientador_id = $1
           AND a.arquivado = false
           AND a.status <> 'lista_espera'
         ORDER BY u.nome`,
        [orientadorId]
    );
    return rows.map((row) => ({ ...row, horas_realizadas: Number(row.horas_realizadas) }));
}

module.exports = {
    BANCA_VAZIA,
    buscarPorAluno,
    salvar,
    encerrar,
    reabrir,
    listarPorOrientador,
};
