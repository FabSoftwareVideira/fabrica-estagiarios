const { pool } = require('../config/database');

function erro(mensagem, status = 409) {
    return Object.assign(new Error(mensagem), { status });
}

async function listar(alunoId) {
    const { rows } = await pool.query(`
        SELECT d.*, COALESCE(SUM(a.horas) FILTER (WHERE a.status_validacao = 'validada'), 0) AS horas_validadas
        FROM desligamentos d LEFT JOIN atividades a ON a.desligamento_id = d.id
        WHERE d.aluno_id = $1 AND d.revertido_em IS NULL
        GROUP BY d.id ORDER BY d.desligado_em DESC, d.id DESC`, [alunoId]);
    return rows;
}

async function buscar(id, alunoId) {
    const { rows } = await pool.query(
        'SELECT * FROM desligamentos WHERE id = $1 AND aluno_id = $2 AND revertido_em IS NULL', [id, alunoId]);
    return rows[0] || null;
}

async function atividades(id, alunoId) {
    const { rows } = await pool.query(`
        SELECT a.* FROM atividades a JOIN desligamentos d ON d.id = a.desligamento_id
        WHERE d.id = $1 AND d.aluno_id = $2 AND d.revertido_em IS NULL AND a.status_validacao = 'validada'
        ORDER BY a.data, a.id`, [id, alunoId]);
    return rows;
}

async function desligar(alunoId, userId, versao, gestor = false) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE bancas IN SHARE ROW EXCLUSIVE MODE');
        const { rows } = await client.query(`
            SELECT a.*, u.nome AS supervisor_nome FROM alunos a
            LEFT JOIN usuarios u ON u.id = a.supervisor_id
            WHERE a.usuario_id = $1 FOR UPDATE OF a`, [alunoId]);
        const aluno = rows[0];
        if (!aluno || (!gestor && Number(aluno.supervisor_id) !== Number(userId))) {
            throw erro('Somente o supervisor atual ou o setor de estágios pode registrar o desligamento.', 403);
        }
        if (aluno.status === 'lista_espera' || aluno.arquivado || aluno.encerrado_em
            || Number(aluno.versao_estagio) !== Number(versao)) {
            throw erro('Não há estágio aberto para desligamento.');
        }
        const { rows: bancas } = await client.query('SELECT situacao FROM bancas WHERE aluno_id = $1 FOR UPDATE', [alunoId]);
        if (bancas[0]?.situacao === 'realizada') {
            throw erro('A banca já foi realizada; o estágio está concluído e não pode ser desligado.');
        }
        const { rows: fichas } = await client.query(`
            SELECT (SELECT to_jsonb(f) FROM faas f WHERE f.aluno_id = $1) AS faa,
                   (SELECT to_jsonb(f) FROM facs f WHERE f.aluno_id = $1) AS fac,
                   (SELECT to_jsonb(f) FROM fapos f WHERE f.aluno_id = $1) AS fapo,
                   (SELECT to_jsonb(f) FROM fares f WHERE f.aluno_id = $1) AS fare,
                   COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM fichas_rascunhos r WHERE r.aluno_id = $1), '[]'::jsonb) AS rascunhos`, [alunoId]);
        const { rows: criados } = await client.query(`
            INSERT INTO desligamentos (aluno_id, supervisor_id, supervisor_nome, empresa, desligado_por, fichas_anteriores, horario_trabalho_anterior)
            VALUES ($1, $2, $3, $4, $7, $5::jsonb, $6::jsonb) RETURNING id`,
        [alunoId, aluno.supervisor_id, aluno.supervisor_nome || '', aluno.empresa || '', JSON.stringify(fichas[0]), JSON.stringify(aluno.horario_trabalho), userId]);
        const id = criados[0].id;
        await client.query(`UPDATE atividades SET desligamento_id = $2, contabilizar = false
                            WHERE aluno_id = $1 AND desligamento_id IS NULL`, [alunoId, id]);
        for (const tabela of ['faas', 'facs', 'fapos', 'fares', 'fichas_rascunhos']) {
            await client.query(`DELETE FROM ${tabela} WHERE aluno_id = $1`, [alunoId]);
        }
        await client.query(`UPDATE bancas SET situacao = 'cancelada', atualizado_por = $2,
            atualizado_em = NOW(), versao = versao + 1
            WHERE aluno_id = $1 AND situacao IN ('agendada', 'remarcada')`, [alunoId, userId]);
        await client.query(`UPDATE alunos SET status = 'lista_espera', empresa = NULL,
            supervisor_id = NULL, horario_trabalho = '{}'::jsonb,
            versao_estagio = versao_estagio + 1 WHERE usuario_id = $1`, [alunoId]);
        await client.query('COMMIT');
        return { id, bancaCancelada: ['agendada', 'remarcada'].includes(bancas[0]?.situacao) };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function reverter(id, userId, gestor = false) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: vinculos } = await client.query(
            'SELECT aluno_id FROM desligamentos WHERE id = $1 AND ($3 OR supervisor_id = $2)', [id, userId, gestor]);
        if (!vinculos.length) throw erro('Você não pode reverter este desligamento.', 403);
        const alunoId = vinculos[0].aluno_id;
        const { rows: alunos } = await client.query('SELECT * FROM alunos WHERE usuario_id = $1 FOR UPDATE', [alunoId]);
        const { rows: registros } = await client.query(`
            SELECT * FROM desligamentos WHERE id = $1 AND aluno_id = $2 FOR UPDATE`, [id, alunoId]);
        const aluno = alunos[0];
        const registro = registros[0];
        const { rows: ultimos } = await client.query(`
            SELECT id FROM desligamentos WHERE aluno_id = $1 AND revertido_em IS NULL ORDER BY id DESC LIMIT 1`, [alunoId]);
        if (!aluno || !registro || registro.revertido_em || !ultimos.length || Number(ultimos[0].id) !== Number(id)
            || aluno.status !== 'lista_espera' || aluno.supervisor_id || aluno.arquivado || aluno.encerrado_em) {
            throw erro('O desligamento não pode mais ser revertido. O estudante pode já ter iniciado outro estágio ou estar arquivado.');
        }

        const { rows: existentes } = await client.query(`
            SELECT EXISTS (SELECT 1 FROM faas WHERE aluno_id = $1)
                OR EXISTS (SELECT 1 FROM facs WHERE aluno_id = $1)
                OR EXISTS (SELECT 1 FROM fapos WHERE aluno_id = $1)
                OR EXISTS (SELECT 1 FROM fares WHERE aluno_id = $1)
                OR EXISTS (SELECT 1 FROM fichas_rascunhos WHERE aluno_id = $1) AS tem_fichas`, [alunoId]);
        if (existentes[0].tem_fichas) {
            throw erro('Há fichas atuais que impedem a restauração. Procure o setor de estágios.');
        }
        const fichas = registro.fichas_anteriores;
        for (const [chave, tabela] of [['faa', 'faas'], ['fac', 'facs'], ['fapo', 'fapos'], ['fare', 'fares']]) {
            if (fichas[chave]) {
                await client.query(`INSERT INTO ${tabela} SELECT * FROM jsonb_populate_record(NULL::${tabela}, $1::jsonb)`,
                    [JSON.stringify(fichas[chave])]);
            }
        }
        if (fichas.rascunhos?.length) {
            await client.query(`INSERT INTO fichas_rascunhos
                SELECT * FROM jsonb_populate_recordset(NULL::fichas_rascunhos, $1::jsonb)`,
            [JSON.stringify(fichas.rascunhos)]);
        }
        await client.query(`UPDATE atividades SET desligamento_id = NULL, contabilizar = true
            WHERE aluno_id = $1 AND desligamento_id = $2`, [alunoId, id]);
        await client.query(`UPDATE desligamentos SET revertido_em = NOW(), revertido_por = $2 WHERE id = $1`, [id, userId]);
        await client.query(`UPDATE alunos SET empresa = NULLIF($2, ''), supervisor_id = $3,
            horario_trabalho = COALESCE($4::jsonb, horario_trabalho), versao_estagio = versao_estagio + 1,
            status = CASE WHEN COALESCE((SELECT SUM(horas) FROM atividades
                WHERE aluno_id = $1 AND status_validacao = 'validada' AND contabilizar), 0) >= carga_horaria
                THEN 'concluido' ELSE 'em_andamento' END
            WHERE usuario_id = $1`, [alunoId, registro.empresa, registro.supervisor_id,
            registro.horario_trabalho_anterior == null ? null : JSON.stringify(registro.horario_trabalho_anterior)]);
        await client.query('COMMIT');
        return { alunoId, horarioRecuperado: registro.horario_trabalho_anterior != null };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function solicitar(id, alunoId) {
    const { rows } = await pool.query(`
        UPDATE desligamentos d SET solicitado_em = NOW()
        WHERE d.id = $1 AND d.aluno_id = $2 AND d.solicitado_em IS NULL AND d.revertido_em IS NULL
          AND EXISTS (SELECT 1 FROM alunos a WHERE a.usuario_id = d.aluno_id AND a.encerrado_em IS NULL)
          AND EXISTS (SELECT 1 FROM atividades a WHERE a.desligamento_id = d.id AND a.status_validacao = 'validada')
        RETURNING d.id`, [id, alunoId]);
    if (!rows.length) throw erro('A solicitação não está disponível ou já foi registrada.');
}

async function confirmar(id, alunoId, userId, gestor) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: alunos } = await client.query('SELECT * FROM alunos WHERE usuario_id = $1 FOR UPDATE', [alunoId]);
        const aluno = alunos[0];
        if (!aluno || aluno.encerrado_em || aluno.arquivado) throw erro('O estágio está encerrado ou arquivado.');
        if (!gestor && Number(aluno.orientador_id) !== Number(userId)) {
            throw erro('Somente o orientador ou a gestão pode confirmar as horas.', 403);
        }
        const { rows } = await client.query(`
            UPDATE desligamentos SET confirmado_em = NOW(), confirmado_por = $3
            WHERE id = $1 AND aluno_id = $2 AND solicitado_em IS NOT NULL AND confirmado_em IS NULL AND revertido_em IS NULL
            RETURNING id`, [id, alunoId, userId]);
        if (!rows.length) throw erro('O aproveitamento não foi solicitado ou já foi confirmado.');
        await client.query(`UPDATE atividades SET contabilizar = true
            WHERE desligamento_id = $1 AND status_validacao = 'validada'`, [id]);
        await client.query(`UPDATE alunos SET status = CASE
            WHEN status = 'lista_espera' THEN status
            WHEN COALESCE((SELECT SUM(horas) FROM atividades
                WHERE aluno_id = $1 AND status_validacao = 'validada' AND contabilizar), 0) >= carga_horaria
            THEN 'concluido' ELSE 'em_andamento' END WHERE usuario_id = $1`, [alunoId]);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = { listar, buscar, atividades, desligar, reverter, solicitar, confirmar };
