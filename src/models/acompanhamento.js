// Visão do administrador: situação de cada estudante e de cada curso.
const { pool } = require('../config/database');
const { CURSOS } = require('../config/cursos');
const { estagioStatus } = require('../config/status');

// Etapas na ordem em que o estágio acontece.
const ETAPAS_ACOMPANHAMENTO = [
    { chave: 'lista_espera', label: 'Lista de espera', classe: 'status-waiting' },
    { chave: 'em_andamento', label: 'Em andamento', classe: 'status-progress' },
    { chave: 'aguardando_banca', label: 'Aguardando banca', classe: 'status-banca' },
    { chave: 'encerrado', label: 'Encerrado', classe: 'status-completed' },
];
const SEM_CURSO = 'Curso não informado';
const DIAS_SEM_REGISTRO = 5; // mesmo limite do lembrete de atividades

const cursoCurto = (curso) => curso
    ? curso.replace(/^Curso Técnico (de|em) /, '').replace(/ Integrado ao Ensino Médio$/, '')
    : SEM_CURSO;

async function listarEstudantes() {
    const { rows } = await pool.query(`
        SELECT a.usuario_id, u.nome, u.email, a.curso, a.status, a.arquivado, a.encerrado_em, a.empresa,
               a.carga_horaria, a.orientador_id, a.supervisor_id,
               ori.nome AS orientador_nome, sup.nome AS supervisor_nome,
               COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id AND status_validacao = 'validada'), 0) AS horas_validadas,
               COALESCE((SELECT SUM(horas) FROM atividades WHERE aluno_id = a.usuario_id AND status_validacao = 'pendente'), 0) AS horas_pendentes,
               (SELECT TO_CHAR(MAX(data), 'YYYY-MM-DD') FROM atividades WHERE aluno_id = a.usuario_id) AS ultima_atividade,
               FLOOR(EXTRACT(EPOCH FROM (NOW() - a.relatorio_atualizado_em)) / 86400)::int AS dias_sem_registro,
               TO_CHAR(b.data, 'YYYY-MM-DD') AS banca_data
        FROM alunos a
        JOIN usuarios u ON u.id = a.usuario_id
        LEFT JOIN usuarios ori ON ori.id = a.orientador_id
        LEFT JOIN usuarios sup ON sup.id = a.supervisor_id
        LEFT JOIN bancas b ON b.aluno_id = a.usuario_id AND b.situacao IN ('agendada', 'remarcada')
        WHERE a.arquivado = false AND u.ativo = true
        ORDER BY u.nome`);
    return rows.map(detalhar);
}

// Acrescenta etapa, progresso e a lista de pendências que pedem ação de alguém.
function detalhar(linha) {
    const etapa = estagioStatus(linha);
    const carga = Number(linha.carga_horaria) || 0;
    const validadas = Number(linha.horas_validadas) || 0;
    const pendentes = Number(linha.horas_pendentes) || 0;
    const dias = Number(linha.dias_sem_registro) || 0;
    const pendencias = [];

    if (etapa.chave === 'lista_espera') pendencias.push('Aguardando aprovação do cadastro');
    if (!linha.curso) pendencias.push('Curso não informado');
    if (etapa.chave !== 'lista_espera' && !linha.orientador_id) pendencias.push('Sem orientador');
    if (etapa.chave === 'em_andamento') {
        if (!linha.supervisor_id) pendencias.push('Sem supervisor');
        if (dias > DIAS_SEM_REGISTRO) pendencias.push(`Sem registrar há ${dias} dias`);
    }
    if (pendentes > 0 && etapa.chave !== 'encerrado') pendencias.push(`${formatarHoras(pendentes)} aguardando validação`);
    if (etapa.chave === 'aguardando_banca' && !linha.banca_data) pendencias.push('Banca não agendada');

    return {
        ...linha,
        etapa: etapa.chave,
        etapaLabel: etapa.label,
        etapaClasse: etapa.classe,
        cursoCurto: cursoCurto(linha.curso),
        carga,
        validadas,
        pendentes,
        percentual: carga > 0 ? Math.min(100, Math.round((validadas / carga) * 100)) : 0,
        pendencias,
    };
}

function formatarHoras(valor) {
    return `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`;
}

// Totais gerais e por curso. Os cursos cadastrados aparecem mesmo sem estudantes.
function resumir(estudantes) {
    const zerado = () => Object.fromEntries(ETAPAS_ACOMPANHAMENTO.map((e) => [e.chave, 0]));
    const geral = { total: estudantes.length, etapas: zerado(), comPendencias: 0 };
    const porCurso = new Map(CURSOS.map((curso) => [curso, { curso, nome: cursoCurto(curso), total: 0, etapas: zerado(), comPendencias: 0, somaPercentual: 0 }]));

    for (const estudante of estudantes) {
        const chave = estudante.curso && porCurso.has(estudante.curso) ? estudante.curso : '';
        if (!porCurso.has(chave)) porCurso.set(chave, { curso: '', nome: SEM_CURSO, total: 0, etapas: zerado(), comPendencias: 0, somaPercentual: 0 });
        const grupo = porCurso.get(chave);
        for (const alvo of [geral, grupo]) {
            alvo.etapas[estudante.etapa] += 1;
            if (estudante.pendencias.length) alvo.comPendencias += 1;
        }
        grupo.total += 1;
        grupo.somaPercentual += estudante.percentual;
    }

    const cursos = [...porCurso.values()].map((grupo) => ({
        ...grupo,
        progressoMedio: grupo.total ? Math.round(grupo.somaPercentual / grupo.total) : 0,
    }));
    return { geral, cursos };
}

module.exports = { listarEstudantes, detalhar, resumir, formatarHoras, ETAPAS_ACOMPANHAMENTO, SEM_CURSO };
