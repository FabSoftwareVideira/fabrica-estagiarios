const { pool } = require('../config/database');

// Desligamento que ainda pode ser cancelado: o último, não revertido, com o
// estudante de volta à lista de espera e sem ter começado outro estágio.
// Enquanto existir, o estudante aparece como "Desligado" nas listas.
const JOIN_DESLIGAMENTO = `
    LEFT JOIN LATERAL (
        SELECT d.id, d.supervisor_id, d.supervisor_nome, d.empresa, d.desligado_em,
               d.horario_trabalho_anterior IS NULL AS sem_escala
        FROM desligamentos d
        WHERE d.aluno_id = a.usuario_id AND d.revertido_em IS NULL
        ORDER BY d.id DESC LIMIT 1
    ) dl ON a.status = 'lista_espera' AND a.supervisor_id IS NULL
        AND NOT a.arquivado AND a.encerrado_em IS NULL`;
const CAMPOS_DESLIGAMENTO = `dl.id AS desligamento_id, dl.supervisor_id AS desligamento_supervisor_id,
                dl.supervisor_nome AS desligamento_supervisor_nome, dl.empresa AS desligamento_empresa,
                dl.desligado_em, dl.sem_escala AS desligamento_sem_escala`;

async function buscarPorUsuarioId(usuarioId) {
    const { rows } = await pool.query(
        `SELECT a.*, u.nome, u.email,
                sup.nome AS supervisor_nome, ori.nome AS orientador_nome,
                ${CAMPOS_DESLIGAMENTO},
                COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id AND status_validacao = 'validada' AND contabilizar), 0) AS horas_realizadas,
                COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id AND status_validacao = 'pendente' AND desligamento_id IS NULL), 0) AS horas_pendentes
         FROM alunos a
         JOIN usuarios u ON u.id = a.usuario_id
         LEFT JOIN usuarios sup ON sup.id = a.supervisor_id
         LEFT JOIN usuarios ori ON ori.id = a.orientador_id
         ${JOIN_DESLIGAMENTO}
         WHERE a.usuario_id = $1`,
        [usuarioId]
    );
    return rows[0] || null;
}

async function criar({ usuarioId, matricula, curso }) {
    const { rows } = await pool.query(
        `INSERT INTO alunos (usuario_id, matricula, curso) VALUES ($1, $2, $3) RETURNING *`,
        [usuarioId, matricula, curso]
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

async function atualizarCurso(usuarioId, curso) {
    const { rows } = await pool.query(
        'UPDATE alunos SET curso = $2 WHERE usuario_id = $1 RETURNING *',
        [usuarioId, curso]
    );
    return rows[0];
}

// tabela única do dashboard: todos os status, com busca, status e arquivados
const ORDENACOES = {
    nome: 'u.nome',
    supervisor: "COALESCE(sup.nome, '')",
    horas: 'horas_realizadas',
    status: `CASE
                WHEN a.status = 'lista_espera' THEN 1
                WHEN a.status = 'em_andamento' THEN 2
                WHEN a.encerrado_em IS NULL THEN 3
                ELSE 4
             END`,
};

// filtros de status aceitos na listagem. "aguardando_banca" e "encerrado" são
// fases do status "concluido" (horas cumpridas); o valor antigo "concluido"
// continua valendo e pega as duas.
const CONDICOES_STATUS = {
    lista_espera: "(a.status = 'lista_espera' AND dl.id IS NULL)",
    desligado: 'dl.id IS NOT NULL',
    em_andamento: "a.status = 'em_andamento'",
    aguardando_banca: "(a.status = 'concluido' AND a.encerrado_em IS NULL)",
    encerrado: "(a.status = 'concluido' AND a.encerrado_em IS NOT NULL)",
    concluido: "a.status = 'concluido'",
};

async function listar({ status, busca, arquivados, limite, offset, ordenarPor, direcao, orientadorId, supervisorId, professorId }) {
    const valores = [Boolean(arquivados)];
    const filtros = ['a.arquivado = $1'];

    if (professorId != null) {
        valores.push(professorId);
        // além dos próprios estudantes, o professor vê quem está na lista de
        // espera ainda sem orientador (qualquer professor pode aprovar o cadastro)
        // e quem ele desligou, enquanto o desligamento puder ser cancelado
        filtros.push(`(a.orientador_id = $${valores.length} OR a.supervisor_id = $${valores.length}
            OR dl.supervisor_id = $${valores.length}
            OR (a.status = 'lista_espera' AND a.orientador_id IS NULL))`);
    } else if (orientadorId != null) {
        valores.push(orientadorId);
        filtros.push(`a.orientador_id = $${valores.length}`);
    }
    if (supervisorId != null) {
        valores.push(supervisorId);
        filtros.push(`(a.supervisor_id = $${valores.length} OR dl.supervisor_id = $${valores.length})`);
    }

    const statusSelecionados = Array.isArray(status) ? status : (status ? [status] : []);
    const condicoesStatus = statusSelecionados
        .map((chave) => CONDICOES_STATUS[chave])
        .filter(Boolean);
    if (condicoesStatus.length > 0) {
        filtros.push(`(${condicoesStatus.join(' OR ')})`);
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
         ${JOIN_DESLIGAMENTO}
         ${where}`,
        valores
    );

    const expressaoOrdenacao = ORDENACOES[ordenarPor];
    const sentido = direcao === 'desc' ? 'DESC' : 'ASC';
    const ordemPadrao = supervisorId != null
        // supervisor: primeiro quem está aguardando a FAC (horas cumpridas)
        ? `CASE
                WHEN a.status = 'concluido' AND a.encerrado_em IS NULL THEN 1
                WHEN a.status = 'em_andamento' THEN 2
                WHEN a.status = 'concluido' THEN 3
                ELSE 4
           END, u.nome`
        : `${ORDENACOES.status},
           u.nome`;
    const orderBy = expressaoOrdenacao
        ? `${expressaoOrdenacao} ${sentido}, u.nome`
        : ordemPadrao;

    const valoresPagina = [...valores, limite, offset];
    const { rows } = await pool.query(
        `SELECT a.*, u.nome, u.email,
                sup.nome AS supervisor_nome,
                ori.nome AS orientador_nome,
                ${CAMPOS_DESLIGAMENTO},
                EXISTS (SELECT 1 FROM facs f WHERE f.aluno_id = a.usuario_id) AS tem_fac,
                COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id AND status_validacao = 'validada' AND contabilizar), 0) AS horas_realizadas,
                COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id AND status_validacao = 'pendente' AND desligamento_id IS NULL), 0) AS horas_pendentes
         FROM alunos a
         JOIN usuarios u ON u.id = a.usuario_id
         LEFT JOIN usuarios sup ON sup.id = a.supervisor_id
         LEFT JOIN usuarios ori ON ori.id = a.orientador_id
         ${JOIN_DESLIGAMENTO}
         ${where}
         ORDER BY ${orderBy}
         LIMIT $${valoresPagina.length - 1} OFFSET $${valoresPagina.length}`,
        valoresPagina
    );

    return { alunos: rows, total: contagemRows[0].total };
}

// Destaque do painel do supervisor: estudantes que já cumpriram as horas do
// estágio, o estágio ainda não foi encerrado e a FAC continua pendente.
async function listarPendentesFac(supervisorId) {
    const { rows } = await pool.query(
        `SELECT a.*, u.nome, u.email, ori.nome AS orientador_nome,
                COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id AND status_validacao = 'validada' AND contabilizar), 0) AS horas_realizadas
         FROM alunos a
         JOIN usuarios u ON u.id = a.usuario_id
         LEFT JOIN usuarios ori ON ori.id = a.orientador_id
         WHERE a.supervisor_id = $1
           AND a.arquivado = false
           AND a.status = 'concluido'
           AND a.encerrado_em IS NULL
           AND NOT EXISTS (SELECT 1 FROM facs f WHERE f.aluno_id = a.usuario_id)
         ORDER BY u.nome`,
        [supervisorId]
    );
    return rows;
}

async function atualizarEstagio(usuarioId, { status, empresa, supervisorId, orientadorId, cargaHoraria, horarioTrabalho, statusAnterior, versaoAnterior }) {
    // "concluido" nunca é definido manualmente: só quando as horas validadas
    // atingem a carga horária. Qualquer outro status é tratado como em andamento.
    const statusSolicitado = status === 'lista_espera' ? 'lista_espera' : 'em_andamento';
    const empresaNormalizada = (empresa || '').trim() || null;

    const { rows } = await pool.query(
        `UPDATE alunos
         SET status = CASE
                 WHEN $2 = 'lista_espera' THEN 'lista_espera'
                 WHEN COALESCE((
                     SELECT SUM(horas) FROM atividades
                     WHERE aluno_id = $1 AND status_validacao = 'validada' AND contabilizar
                 ), 0) >= $5 THEN 'concluido'
                 ELSE 'em_andamento'
             END,
             empresa = $6,
             supervisor_id = $3,
             orientador_id = $4,
             carga_horaria = $5,
             horario_trabalho = $7::jsonb
         WHERE usuario_id = $1
           AND ($8::text IS NULL OR status = $8)
           AND ($9::integer IS NULL OR versao_estagio = $9)
           AND NOT EXISTS (
               SELECT 1 FROM desligamentos d
               WHERE d.id = (SELECT id FROM desligamentos WHERE aluno_id = $1 AND revertido_em IS NULL ORDER BY id DESC LIMIT 1)
                 AND LOWER(TRIM(d.empresa)) = LOWER(TRIM($6::text))
           )
         RETURNING *`,
        [usuarioId, statusSolicitado, supervisorId || null, orientadorId || null, cargaHoraria, empresaNormalizada, JSON.stringify(horarioTrabalho), statusAnterior || null, versaoAnterior ?? null]
    );
    if (!rows.length) {
        throw Object.assign(new Error('O estágio foi alterado ou o novo local é igual ao anterior. Confira os dados e tente novamente.'), { status: 422 });
    }
    return rows[0];
}

// professores comuns arquivam apenas quem está na lista de espera ou encerrou;
// administradores podem arquivar em qualquer etapa.
async function arquivar(usuarioId, admin = false) {
    const { rows } = await pool.query(
        `UPDATE alunos SET arquivado = true
         WHERE usuario_id = $1
           AND arquivado = false
           AND ($2::boolean OR status = 'lista_espera'
                OR (status = 'concluido' AND encerrado_em IS NOT NULL))
         RETURNING usuario_id`,
        [usuarioId, admin]
    );
    return rows.length > 0;
}

async function desarquivar(usuarioId) {
    await pool.query('UPDATE alunos SET arquivado = false WHERE usuario_id = $1', [usuarioId]);
}

module.exports = {
    JOIN_DESLIGAMENTO,
    CAMPOS_DESLIGAMENTO,
    buscarPorUsuarioId,
    criar,
    buscarPorMatricula,
    atualizarMatricula,
    atualizarCurso,
    listar,
    listarPendentesFac,
    atualizarEstagio,
    arquivar,
    desarquivar,
};
