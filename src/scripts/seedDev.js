const { pool } = require('../config/database');
const { CURSOS } = require('../config/cursos');

const supervisores = [
    { nome: 'Marina Supervisora de Teste', email: 'supervisora1@example.test' },
    { nome: 'Rafael Supervisor de Teste', email: 'supervisor2@example.test' },
    { nome: 'Paula Supervisora de Teste', email: 'supervisora3@example.test' },
];

const orientadores = [
    { nome: 'Carlos Orientador de Teste', email: 'orientador1@example.test' },
    { nome: 'Luiza Orientadora de Teste', email: 'orientadora2@example.test' },
    { nome: 'André Orientador de Teste', email: 'orientador3@example.test' },
];

const supervisorExterno = {
    nome: 'Alex Supervisor Externo de Teste',
    email: 'supervisor.externo@example.test',
};

const estudantes = Array.from({ length: 12 }, (_, indice) => ({
    nome: `Estudante de Teste ${String(indice + 1).padStart(2, '0')}`,
    email: `estudante${String(indice + 1).padStart(2, '0')}@example.test`,
    matricula: `TESTE${String(indice + 1).padStart(4, '0')}`,
    supervisor: indice < 3 ? 'externo' : indice % supervisores.length,
    orientador: indice % orientadores.length,
    status: indice < 2 ? 'lista_espera' : 'em_andamento',
    curso: CURSOS[indice % CURSOS.length],
}));

async function criarUsuario(client, { nome, email, tipo }) {
    const { rows } = await client.query(
        `INSERT INTO usuarios (nome, email, tipo, nome_confirmado)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (email) DO UPDATE
         SET nome = EXCLUDED.nome, tipo = EXCLUDED.tipo, nome_confirmado = true
         RETURNING id`,
        [nome, email, tipo]
    );
    return rows[0].id;
}

async function executar() {
    if (process.env.APP_ENV !== 'development') {
        throw new Error('O seed de demonstração só pode ser executado com APP_ENV=development.');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const idsSupervisores = [];
        for (const usuario of supervisores) {
            const id = await criarUsuario(client, { ...usuario, tipo: 'professor' });
            await client.query(
                `INSERT INTO professores (usuario_id, cargo)
                 VALUES ($1, 'comum')
                 ON CONFLICT (usuario_id) DO NOTHING`,
                [id]
            );
            idsSupervisores.push(id);
        }

        const idSupervisorExterno = await criarUsuario(client, { ...supervisorExterno, tipo: 'professor' });
        await client.query(
            `INSERT INTO professores (usuario_id, cargo, aprovado)
             VALUES ($1, 'supervisor', true)
             ON CONFLICT (usuario_id) DO UPDATE
             SET cargo = 'supervisor', aprovado = true`,
            [idSupervisorExterno]
        );

        const idsOrientadores = [];
        for (const usuario of orientadores) {
            const id = await criarUsuario(client, { ...usuario, tipo: 'professor' });
            await client.query(
                `INSERT INTO professores (usuario_id, cargo)
                 VALUES ($1, 'comum')
                 ON CONFLICT (usuario_id) DO NOTHING`,
                [id]
            );
            idsOrientadores.push(id);
        }

        const idsEstudantes = [];
        for (const estudante of estudantes) {
            const id = await criarUsuario(client, { ...estudante, tipo: 'aluno' });
            await client.query(
                `INSERT INTO alunos (
                     usuario_id, matricula, curso, empresa, status, supervisor_id, orientador_id,
                     carga_horaria, arquivado, encerrado_em, horario_trabalho
                 )
                 VALUES ($1, $2, $3, 'Empresa de Teste', $4, $5, $6, 60, false, NULL, $7::jsonb)
                 ON CONFLICT (usuario_id) DO UPDATE
                 SET matricula = EXCLUDED.matricula,
                     curso = EXCLUDED.curso,
                     empresa = EXCLUDED.empresa,
                     status = EXCLUDED.status,
                     supervisor_id = EXCLUDED.supervisor_id,
                     orientador_id = EXCLUDED.orientador_id,
                     carga_horaria = EXCLUDED.carga_horaria,
                     arquivado = false,
                     encerrado_em = NULL,
                     horario_trabalho = EXCLUDED.horario_trabalho`,
                [
                    id,
                    estudante.matricula,
                    estudante.curso,
                    estudante.status,
                    estudante.supervisor === 'externo'
                        ? idSupervisorExterno
                        : idsSupervisores[estudante.supervisor],
                    idsOrientadores[estudante.orientador],
                    JSON.stringify({
                        1: { inicio: '08:00', fim: '12:00' },
                        3: { inicio: '08:00', fim: '12:00' },
                        5: { inicio: '08:00', fim: '12:00' },
                    }),
                ]
            );
            idsEstudantes.push(id);
        }

        await client.query(
            `INSERT INTO atividades (aluno_id, data, horas, descricao, status_validacao)
             SELECT estudante_id, CURRENT_DATE - dia, 4,
                    'Atividade de demonstração ' || dia,
                    CASE WHEN dia % 3 = 0 THEN 'pendente' ELSE 'validada' END
             FROM UNNEST($1::integer[]) AS estudantes(estudante_id)
             CROSS JOIN GENERATE_SERIES(1, 4) AS dias(dia)
             WHERE NOT EXISTS (
                 SELECT 1 FROM atividades atividade
                 WHERE atividade.aluno_id = estudante_id
                   AND atividade.data = CURRENT_DATE - dia
                   AND atividade.descricao = 'Atividade de demonstração ' || dia
             )`,
            [idsEstudantes.slice(2)]
        );

        await client.query('COMMIT');
        console.log(
            `[seed-dev] ${estudantes.length} estudantes, ${supervisores.length} supervisores e ` +
            `${orientadores.length} orientadores e um supervisor externo preparados. Seed pode ser executado novamente.`
        );
    } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
    } finally {
        client.release();
        await pool.end();
    }
}

executar().catch((erro) => {
    console.error('[seed-dev] erro:', erro.message);
    process.exitCode = 1;
});
