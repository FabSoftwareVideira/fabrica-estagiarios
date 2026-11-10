const { pool } = require('../config/database');
const { dataParaInput } = require('../utils/datas');
const { agoraBrasilia } = require('../utils/bancas');

const SELECT = `SELECT b.*, TO_CHAR(b.data, 'YYYY-MM-DD') AS data, u.nome AS aluno_nome, a.matricula, a.empresa,
    o.nome AS orientador_nome, p1.nome AS avaliador_1_nome, p2.nome AS avaliador_2_nome,
    editor.nome AS atualizado_por_nome, a.encerrado_em,
    u.email AS aluno_email, o.email AS orientador_email, p1.email AS avaliador_1_email, p2.email AS avaliador_2_email,
    u.receber_email_bancas AS aluno_recebe_email, o.receber_email_bancas AS orientador_recebe_email,
    p1.receber_email_bancas AS avaliador_1_recebe_email, p2.receber_email_bancas AS avaliador_2_recebe_email
    FROM bancas b JOIN alunos a ON a.usuario_id = b.aluno_id
    JOIN usuarios u ON u.id = b.aluno_id JOIN usuarios o ON o.id = b.orientador_id
    JOIN usuarios p1 ON p1.id = b.avaliador_1_id JOIN usuarios p2 ON p2.id = b.avaliador_2_id
    LEFT JOIN usuarios editor ON editor.id = b.atualizado_por`;
const normalizar = (b) => b ? { ...b, data: dataParaInput(b.data), hora_inicio: String(b.hora_inicio).slice(0, 5), hora_fim: String(b.hora_fim).slice(0, 5) } : null;
function erro(mensagem, status = 422) { return Object.assign(new Error(mensagem), { status }); }

async function buscarPorAluno(alunoId) {
    const { rows } = await pool.query(`${SELECT} WHERE b.aluno_id = $1`, [alunoId]);
    return normalizar(rows[0]);
}
// participanteId (opcional) restringe às bancas em que o professor é orientador ou avaliador.
async function listar({ inicio = '', fim = '', situacao = '', participanteId = null } = {}) {
    const { rows } = await pool.query(`${SELECT}
        WHERE ($1::date IS NULL OR b.data >= $1::date) AND ($2::date IS NULL OR b.data <= $2::date)
        AND ($3::text = '' OR b.situacao = $3)
        AND ($4::integer IS NULL OR $4::integer IN (b.orientador_id, b.avaliador_1_id, b.avaliador_2_id))
        ORDER BY b.data, b.hora_inicio, u.nome`, [inicio || null, fim || null, situacao, participanteId || null]);
    return rows.map(normalizar);
}
// Próximas bancas (agendadas ou remarcadas) em que o professor participa.
async function listarProximasDoProfessor(professorId, hoje = agoraBrasilia().data) {
    const { rows } = await pool.query(`${SELECT}
        WHERE b.data >= $2::date AND b.situacao IN ('agendada', 'remarcada')
        AND $1::integer IN (b.orientador_id, b.avaliador_1_id, b.avaliador_2_id)
        ORDER BY b.data, b.hora_inicio, u.nome`, [professorId, hoje]);
    return rows.map(normalizar);
}
async function listarAlunosDisponiveis(user) {
    const { rows } = await pool.query(`SELECT a.usuario_id, u.nome, o.nome AS orientador_nome
        FROM alunos a JOIN usuarios u ON u.id=a.usuario_id
        JOIN usuarios o ON o.id=a.orientador_id
        LEFT JOIN bancas b ON b.aluno_id=a.usuario_id
        WHERE a.status='concluido' AND NOT a.arquivado AND a.encerrado_em IS NULL
          AND ($2::boolean OR a.orientador_id=$1)
          AND (b.aluno_id IS NULL OR b.situacao='cancelada') ORDER BY u.nome`, [user.id, user.cargo === 'admin']);
    return rows;
}

async function alterar(alunoId, user, versao, operacao) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Agendamentos são pouco frequentes. Serializa as alterações para que
        // duas requisições não reservem simultaneamente a mesma sala/pessoa.
        await client.query('LOCK TABLE bancas IN SHARE ROW EXCLUSIVE MODE');
        const { rows: alunos } = await client.query('SELECT * FROM alunos WHERE usuario_id=$1 FOR UPDATE', [alunoId]);
        const aluno = alunos[0];
        if (!aluno || !(user.cargo === 'admin' || Number(aluno.orientador_id) === Number(user.id))) {
            throw erro('Apenas o orientador do estudante ou um administrador pode gerenciar esta banca.', 403);
        }
        const { rows } = await client.query("SELECT *, TO_CHAR(data, 'YYYY-MM-DD') AS data FROM bancas WHERE aluno_id=$1", [alunoId]);
        const atual = normalizar(rows[0]);
        if (Number(versao) !== (atual?.versao || 0)) throw erro('Esta banca foi alterada por outra pessoa. Atualize a página antes de continuar.', 409);
        const resultado = await operacao(client, aluno, atual);
        await client.query('COMMIT');
        return resultado;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally { client.release(); }
}

async function salvar(alunoId, user, valores) {
    return alterar(alunoId, user, valores.versao, async (client, aluno, atual) => {
        if (aluno.status !== 'concluido' || aluno.arquivado || aluno.encerrado_em || atual?.situacao === 'realizada') {
            throw erro('O agendamento exige as horas cumpridas e um estágio aberto, não arquivado. Bancas realizadas não podem ser remarcadas.');
        }
        const participantes = [Number(aluno.orientador_id), Number(valores.avaliador_1_id), Number(valores.avaliador_2_id)];
        if (new Set(participantes).size !== 3) throw erro('O orientador e os dois avaliadores devem ser pessoas diferentes.');
        const { rows: professores } = await client.query(`SELECT u.id FROM usuarios u LEFT JOIN professores p ON p.usuario_id = u.id
            WHERE u.tipo='professor' AND u.id=ANY($1::integer[])
              AND (u.id = $2 OR COALESCE(p.papel_orientador, true))`, [participantes, participantes[0]]);
        if (professores.length !== 3) throw erro('Selecione orientador e avaliadores cadastrados como professores.');
        const { rows: conflitos } = await client.query(`SELECT b.sala, TO_CHAR(b.hora_inicio, 'HH24:MI') AS inicio,
            TO_CHAR(b.hora_fim, 'HH24:MI') AS fim FROM bancas b
            WHERE b.aluno_id <> $1 AND b.situacao <> 'cancelada' AND b.data=$2::date
              AND b.hora_inicio < $4::time AND b.hora_fim > $3::time
              AND (LOWER(REGEXP_REPLACE(TRIM(b.sala), '\\s+', ' ', 'g')) = LOWER(REGEXP_REPLACE(TRIM($5::text), '\\s+', ' ', 'g'))
                   OR ARRAY[b.orientador_id,b.avaliador_1_id,b.avaliador_2_id] && $6::integer[])
            LIMIT 1`, [alunoId, valores.data, valores.hora_inicio, valores.hora_fim, valores.sala, participantes]);
        if (conflitos.length) throw erro(`Conflito de horário: a sala ou um participante já está reservado das ${conflitos[0].inicio} às ${conflitos[0].fim}. Escolha outro horário, sala ou avaliadores.`, 409);
        const mudou = atual && ['data','hora_inicio','hora_fim','sala','avaliador_1_id','avaliador_2_id','link_reuniao']
            .some((campo) => String(atual[campo]) !== String(valores[campo]));
        const situacao = atual && (mudou || atual.situacao === 'cancelada' || atual.orientador_id !== aluno.orientador_id) ? 'remarcada' : (atual?.situacao || 'agendada');
        const { rows } = await client.query(`INSERT INTO bancas
            (aluno_id,orientador_id,avaliador_1_id,avaliador_2_id,data,hora_inicio,hora_fim,sala,link_reuniao,observacoes,situacao,atualizado_por)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (aluno_id) DO UPDATE SET orientador_id=EXCLUDED.orientador_id,
              avaliador_1_id=EXCLUDED.avaliador_1_id,avaliador_2_id=EXCLUDED.avaliador_2_id,
              data=EXCLUDED.data,hora_inicio=EXCLUDED.hora_inicio,hora_fim=EXCLUDED.hora_fim,
              sala=EXCLUDED.sala,link_reuniao=EXCLUDED.link_reuniao,observacoes=EXCLUDED.observacoes,
              situacao=EXCLUDED.situacao,atualizado_por=EXCLUDED.atualizado_por,
              atualizado_em=NOW(),versao=bancas.versao+1 RETURNING *, TO_CHAR(data, 'YYYY-MM-DD') AS data`,
        [alunoId,...participantes,valores.data,valores.hora_inicio,valores.hora_fim,valores.sala,
            valores.link_reuniao,valores.observacoes,situacao,user.id]);
        return normalizar(rows[0]);
    });
}

async function definirSituacao(alunoId, user, versao, situacao) {
    if (!['cancelada', 'realizada'].includes(situacao)) throw erro('Situação inválida.');
    return alterar(alunoId, user, versao, async (client, aluno, atual) => {
        if (!atual || !['agendada', 'remarcada'].includes(atual.situacao)) throw erro('Esta banca não está agendada.');
        const agora = agoraBrasilia();
        if (situacao === 'realizada' && `${atual.data} ${atual.hora_fim}` > `${agora.data} ${agora.hora}`) {
            throw erro('A banca só pode ser marcada como realizada após o horário de término.');
        }
        await client.query(`UPDATE bancas SET situacao=$2,atualizado_por=$3,atualizado_em=NOW(),versao=versao+1 WHERE aluno_id=$1`, [alunoId, situacao, user.id]);
    });
}

module.exports = { buscarPorAluno, listar, listarProximasDoProfessor, listarAlunosDisponiveis, salvar, definirSituacao };
