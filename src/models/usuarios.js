const { pool } = require('../config/database');

async function buscarPorEmail(email) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)', [email]);
    return rows[0] || null;
}

async function buscarPorGithubId(githubId) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE github_id = $1', [githubId]);
    return rows[0] || null;
}

async function buscarPorGoogleId(googleId) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE google_id = $1', [googleId]);
    return rows[0] || null;
}

async function buscarPorId(id) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    return rows[0] || null;
}

async function buscarAcessoPorId(id) {
    const { rows } = await pool.query(
        `SELECT u.id, u.nome, u.email, u.tipo, u.ativo,
                p.cargo, p.aprovado AS supervisor_aprovado, u.avatar_emoji
         FROM usuarios u
         LEFT JOIN professores p ON p.usuario_id = u.id
         WHERE u.id = $1`,
        [id]
    );
    return rows[0] || null;
}

async function criar({ nome, email, tipo, githubId, googleId, avatarUrl, nomeConfirmado = false }) {
    const { rows } = await pool.query(
        `INSERT INTO usuarios (nome, email, tipo, github_id, google_id, avatar_url, nome_confirmado)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [nome, email, tipo, githubId, googleId, avatarUrl, nomeConfirmado]
    );
    return rows[0];
}

async function listarTodos({
    busca = '',
    tipo = '',
    situacao = '',
    ordenarPor = 'nome',
    direcao = 'asc',
    limite = 10,
    offset = 0,
} = {}) {
    const valores = [];
    const condicoes = [];
    const termo = String(busca || '').trim();
    if (termo) {
        valores.push(`%${termo}%`);
        condicoes.push(`(u.nome ILIKE $${valores.length} OR u.email ILIKE $${valores.length})`);
    }
    if (tipo === 'aluno') condicoes.push("u.tipo = 'aluno'");
    if (tipo === 'professor') condicoes.push("u.tipo = 'professor' AND COALESCE(p.cargo, 'comum') <> 'supervisor'");
    if (tipo === 'supervisor') condicoes.push("u.tipo = 'professor' AND p.cargo = 'supervisor'");
    if (situacao === 'ativo') condicoes.push('u.ativo = true');
    if (situacao === 'desativado') condicoes.push('u.ativo = false');
    if (situacao === 'pendente') condicoes.push("u.tipo = 'professor' AND p.cargo = 'supervisor' AND p.aprovado = false");
    if (situacao === 'aprovado') condicoes.push("u.tipo = 'professor' AND p.cargo = 'supervisor' AND p.aprovado = true");
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const orderBy = {
        nome: 'u.nome',
        email: 'u.email',
        tipo: "CASE WHEN u.tipo = 'aluno' THEN 'Estudante' WHEN p.cargo = 'supervisor' THEN 'Supervisor externo' ELSE 'Professor' END",
        criado_em: 'u.criado_em',
        situacao: `CASE WHEN u.ativo = false THEN 2 WHEN p.cargo = 'supervisor' AND p.aprovado = false THEN 1 ELSE 0 END`,
    }[ordenarPor] || 'u.nome';
    const orderDirection = direcao === 'desc' ? 'DESC' : 'ASC';

    const { rows: totais } = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM usuarios u
         LEFT JOIN professores p ON p.usuario_id = u.id
         LEFT JOIN alunos a ON a.usuario_id = u.id
         ${where}`,
        valores
    );
    const { rows } = await pool.query(
        `SELECT u.id, u.nome, u.email, u.tipo, u.ativo, u.criado_em,
                p.cargo, p.aprovado AS supervisor_aprovado,
                p.empresa_externa, p.funcao_externa,
                a.matricula, a.status AS status_estagio
         FROM usuarios u
         LEFT JOIN professores p ON p.usuario_id = u.id
         LEFT JOIN alunos a ON a.usuario_id = u.id
         ${where}
         ORDER BY ${orderBy} ${orderDirection} NULLS LAST, u.id ASC
         LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, limite, offset]
    );
    return { usuarios: rows, total: totais[0].total };
}

async function listarSupervisoresPendentes(busca = '') {
    const valores = [];
    let where = "p.cargo = 'supervisor' AND p.aprovado = false";
    const termo = String(busca || '').trim();
    if (termo) {
        valores.push(`%${termo}%`);
        where += ` AND (u.nome ILIKE $1 OR u.email ILIKE $1 OR p.empresa_externa ILIKE $1)`;
    }
    const { rows } = await pool.query(
        `SELECT u.id, u.nome, u.email, u.ativo, p.empresa_externa, p.funcao_externa
         FROM professores p
         JOIN usuarios u ON u.id = p.usuario_id
         WHERE ${where}
         ORDER BY u.criado_em, u.nome`,
        valores
    );
    return rows;
}

async function contarSupervisoresPendentes() {
    const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS total FROM professores WHERE cargo = 'supervisor' AND aprovado = false"
    );
    return rows[0].total;
}

async function criarContaAdministrada({ nome, email, tipo, matricula, curso, empresa, funcao }) {
    const { rows } = await pool.query(
        `WITH novo_usuario AS (
            INSERT INTO usuarios (nome, email, tipo, nome_confirmado)
            VALUES ($1, $2, $3, true)
            RETURNING id
        ),
        novo_aluno AS (
            INSERT INTO alunos (usuario_id, matricula, curso)
            SELECT id, $5, $8 FROM novo_usuario WHERE $4 = 'aluno'
            RETURNING usuario_id
        ),
        novo_professor AS (
            INSERT INTO professores
                (usuario_id, cargo, aprovado, empresa_externa, funcao_externa, receber_relatorio_semanal)
            SELECT id,
                   CASE WHEN $4 = 'supervisor' THEN 'supervisor' ELSE 'comum' END,
                   $4 <> 'supervisor',
                   CASE WHEN $4 = 'supervisor' THEN $6 ELSE NULL END,
                   CASE WHEN $4 = 'supervisor' THEN $7 ELSE NULL END,
                   $4 <> 'supervisor'
            FROM novo_usuario WHERE $4 <> 'aluno'
            RETURNING usuario_id
        )
        SELECT id FROM novo_usuario`,
        [nome, email, tipo === 'aluno' ? 'aluno' : 'professor', tipo, matricula || null, empresa || null, funcao || null, curso || null]
    );
    return rows[0].id;
}

async function definirAtivo(id, ativo) {
    const { rowCount } = await pool.query(
        'UPDATE usuarios SET ativo = $2 WHERE id = $1',
        [id, ativo]
    );
    return rowCount > 0;
}

async function excluirSeSemVinculos(id) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const usuario = await client.query(
            'SELECT id FROM usuarios WHERE id = $1 FOR UPDATE',
            [id]
        );
        if (!usuario.rows.length) {
            await client.query('ROLLBACK');
            return { excluido: false, motivo: 'nao_encontrado' };
        }

        await client.query('SELECT usuario_id FROM alunos WHERE usuario_id = $1 FOR UPDATE', [id]);
        const { rows: referencias } = await client.query(
            `SELECT filho_ns.nspname AS filho_schema, filho.relname AS filho_tabela,
                    filho_col.attname AS filho_coluna,
                    pai.relname AS pai_tabela, pai_col.attname AS pai_coluna
             FROM pg_constraint fk
             JOIN pg_class filho ON filho.oid = fk.conrelid
             JOIN pg_namespace filho_ns ON filho_ns.oid = filho.relnamespace
             JOIN pg_class pai ON pai.oid = fk.confrelid
             JOIN pg_namespace pai_ns ON pai_ns.oid = pai.relnamespace
             JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS chaves_filho(attnum, ordem) ON true
             JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY AS chaves_pai(attnum, ordem)
               ON chaves_pai.ordem = chaves_filho.ordem
             JOIN pg_attribute filho_col ON filho_col.attrelid = filho.oid AND filho_col.attnum = chaves_filho.attnum
             JOIN pg_attribute pai_col ON pai_col.attrelid = pai.oid AND pai_col.attnum = chaves_pai.attnum
             WHERE fk.contype = 'f'
               AND filho_ns.nspname = 'public' AND pai_ns.nspname = 'public'
               AND pai.relname IN ('usuarios', 'alunos')
               AND cardinality(fk.conkey) = 1 AND cardinality(fk.confkey) = 1`,
        );

        for (const referencia of referencias) {
            const perfilProprio = referencia.pai_tabela === 'usuarios'
                && ['alunos', 'professores'].includes(referencia.filho_tabela)
                && referencia.filho_coluna === 'usuario_id';
            if (perfilProprio) continue;

            const relacao = referencia.pai_tabela === 'usuarios'
                ? `SELECT EXISTS (
                       SELECT 1 FROM "${referencia.filho_schema}"."${referencia.filho_tabela}" filho
                       WHERE filho."${referencia.filho_coluna}" = $1
                   ) AS existe`
                : `SELECT EXISTS (
                       SELECT 1
                       FROM "${referencia.filho_schema}"."${referencia.filho_tabela}" filho
                       JOIN public.alunos pai
                         ON pai."${referencia.pai_coluna}" = filho."${referencia.filho_coluna}"
                       WHERE pai.usuario_id = $1
                   ) AS existe`;
            const { rows } = await client.query(relacao, [id]);
            if (rows[0].existe) {
                await client.query('ROLLBACK');
                return { excluido: false, motivo: 'vinculado' };
            }
        }

        await client.query('DELETE FROM usuarios WHERE id = $1', [id]);
        await client.query('COMMIT');
        return { excluido: true };
    } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
    } finally {
        client.release();
    }
}

// casa uma conta que já existia (ex.: seed do admin, sem github_id ainda)
// com o github_id assim que a pessoa loga pela primeira vez
async function vincularGithubId(usuarioId, githubId, avatarUrl) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET github_id = $2, avatar_url = $3 WHERE id = $1 RETURNING *`,
        [usuarioId, githubId, avatarUrl]
    );
    return rows[0];
}

async function vincularGoogleId(usuarioId, googleId, avatarUrl) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET google_id = $2, avatar_url = $3 WHERE id = $1 RETURNING *`,
        [usuarioId, googleId, avatarUrl]
    );
    return rows[0];
}

async function listarProfessores() {
    const { rows } = await pool.query(
        `SELECT u.id, u.nome, u.email FROM usuarios u
         JOIN professores p ON p.usuario_id = u.id
         WHERE u.tipo = 'professor' AND u.ativo = true
           AND p.cargo <> 'supervisor' AND p.aprovado = true
         ORDER BY u.nome`
    );
    return rows;
}

async function listarSupervisores() {
    const { rows } = await pool.query(
        `SELECT u.id, u.nome, u.email FROM usuarios u
         JOIN professores p ON p.usuario_id = u.id
         WHERE u.tipo = 'professor' AND u.ativo = true
           AND p.cargo = 'supervisor' AND p.aprovado = true
         ORDER BY u.nome`
    );
    return rows;
}

// o GitHub às vezes só devolve o primeiro nome (ou o "login") no perfil,
// então pedimos confirmação/edição do nome completo no primeiro acesso —
// tanto pra aluno (junto da matrícula) quanto pra professor (tela própria)
async function confirmarNome(usuarioId, nome) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET nome = $2, nome_confirmado = true WHERE id = $1 RETURNING *`,
        [usuarioId, nome]
    );
    return rows[0];
}

async function atualizarPerfil(usuarioId, nome) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET nome = $2, nome_confirmado = true WHERE id = $1 RETURNING *`,
        [usuarioId, nome]
    );
    return rows[0];
}

// Preferências de e-mail escolhidas no perfil (o resumo semanal fica em professores).
async function definirPreferenciasEmail(usuarioId, { bancas, lembretes }) {
    await pool.query(
        'UPDATE usuarios SET receber_email_bancas = $2, receber_lembretes_atividades = $3 WHERE id = $1',
        [usuarioId, Boolean(bancas), Boolean(lembretes)]
    );
}

async function atualizarAvatar(usuarioId, avatarEmoji) {
    const { rows } = await pool.query(
        `UPDATE usuarios SET avatar_emoji = $2 WHERE id = $1 RETURNING *`,
        [usuarioId, avatarEmoji]
    );
    return rows[0];
}

module.exports = {
    buscarPorEmail,
    buscarPorGithubId,
    buscarPorGoogleId,
    buscarPorId,
    buscarAcessoPorId,
    listarTodos,
    listarSupervisoresPendentes,
    contarSupervisoresPendentes,
    criarContaAdministrada,
    definirAtivo,
    excluirSeSemVinculos,
    criar,
    vincularGithubId,
    vincularGoogleId,
    listarProfessores,
    listarSupervisores,
    confirmarNome,
    atualizarPerfil,
    atualizarAvatar,
    definirPreferenciasEmail,
};
