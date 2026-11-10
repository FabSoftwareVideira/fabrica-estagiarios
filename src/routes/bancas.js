const router = require('express').Router();
const bancas = require('../models/bancas');
const alunos = require('../models/alunos');
const usuarios = require('../models/usuarios');
const { setFlash } = require('../middleware/auth');
const { dataIsoValida, formatarDataBr } = require('../utils/datas');
const { agoraBrasilia, lerAgendamento, SITUACOES_BANCA, celulaCsv } = require('../utils/bancas');
const { notificarBanca, participantesDaBanca } = require('../services/conviteBanca');

// Campos cuja mudança justifica avisar os participantes de novo.
const CAMPOS_DO_CONVITE = ['data', 'hora_inicio', 'hora_fim', 'sala', 'link_reuniao', 'observacoes', 'orientador_id', 'avaliador_1_id', 'avaliador_2_id'];
const AVISO_SEM_EMAIL = ' Não foi possível enviar o aviso por e-mail; avise os participantes por outro meio.';

function filtrosDaAgenda(query) {
    const filtros = { inicio: typeof query.inicio === 'string' ? query.inicio : agoraBrasilia().data,
        fim: typeof query.fim === 'string' ? query.fim : '', situacao: typeof query.situacao === 'string' ? query.situacao : '',
        minhas: query.minhas === '1' ? '1' : '' };
    if ((filtros.inicio && !dataIsoValida(filtros.inicio)) || (filtros.fim && !dataIsoValida(filtros.fim))
        || (filtros.inicio && filtros.fim && filtros.fim < filtros.inicio)
        || (filtros.situacao && !Object.hasOwn(SITUACOES_BANCA, filtros.situacao))) {
        throw Object.assign(new Error('Revise as datas e a situação usadas no filtro.'), { status: 400 });
    }
    return filtros;
}
router.get('/bancas', async (req, res) => {
    let filtros;
    try { filtros = filtrosDaAgenda(req.query); } catch (e) { return res.status(e.status).send(e.message); }
    const participanteId = filtros.minhas ? req.session.user.id : null;
    const [agenda, disponiveis] = await Promise.all([bancas.listar({ ...filtros, participanteId }), bancas.listarAlunosDisponiveis(req.session.user)]);
    res.render('professor_bancas', { agenda, disponiveis, filtros, situacoes: SITUACOES_BANCA,
        queryCsv: new URLSearchParams(filtros).toString() });
});
router.get('/bancas/nova', (req, res) => {
    if (!/^[1-9]\d*$/.test(req.query.aluno_id || '')) return res.redirect('/professor/bancas');
    res.redirect(`/professor/aluno/${req.query.aluno_id}/banca`);
});
router.get('/bancas/exportar.csv', async (req, res) => {
    let filtros;
    try { filtros = filtrosDaAgenda(req.query); } catch (e) { return res.status(e.status).send(e.message); }
    const agenda = await bancas.listar({ ...filtros, participanteId: filtros.minhas ? req.session.user.id : null });
    const linhas = [['Estudante','Matrícula','Empresa','Orientador','Avaliador 1','Avaliador 2','Data','Início','Término','Fuso','Sala/local','Link','Situação','Observações'],
        ...agenda.map((b) => [b.aluno_nome,b.matricula,b.empresa,b.orientador_nome,b.avaliador_1_nome,b.avaliador_2_nome,
            formatarDataBr(b.data),b.hora_inicio,b.hora_fim,'America/Sao_Paulo',b.sala,b.link_reuniao,SITUACOES_BANCA[b.situacao],b.observacoes])];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="agenda-bancas.csv"');
    res.setHeader('Cache-Control', 'no-store, private');
    res.send('\uFEFF' + linhas.map((linha) => linha.map(celulaCsv).join(';')).join('\r\n'));
});

async function carregar(req, res, next) {
    if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(404).send('Estudante não encontrado.');
    const aluno = await alunos.buscarPorUsuarioId(req.params.id);
    if (!aluno) return res.status(404).send('Estudante não encontrado.');
    req.aluno = aluno;
    next();
}
async function renderizar(req, res, valores, erros = []) {
    const [banca, professores] = await Promise.all([bancas.buscarPorAluno(req.params.id), usuarios.listarProfessores()]);
    const gerencia = req.session.user.cargo === 'admin' || Number(req.aluno.orientador_id) === Number(req.session.user.id);
    const podeEditar = gerencia && req.aluno.status === 'concluido' && !req.aluno.encerrado_em && !req.aluno.arquivado && banca?.situacao !== 'realizada';
    res.render('professor_banca', { aluno: req.aluno, banca, professores, podeEditar, gerencia,
        situacoes: SITUACOES_BANCA, erros, hoje: agoraBrasilia().data,
        valores: valores || banca || { data: '', hora_inicio: '', hora_fim: '', sala: '', link_reuniao: '',
            observacoes: '', avaliador_1_id: '', avaliador_2_id: '', versao: 0 } });
}
router.get('/aluno/:id/banca', carregar, (req, res) => renderizar(req, res));
router.post('/aluno/:id/banca', carregar, async (req, res) => {
    if (!(req.session.user.cargo === 'admin' || Number(req.aluno.orientador_id) === Number(req.session.user.id))) {
        return res.status(403).send('Apenas o orientador do estudante ou um administrador pode gerenciar esta banca.');
    }
    const { valores, erros } = lerAgendamento(req.body);
    if (erros.length) return renderizar(req, res.status(422), valores, erros);
    try {
        const antes = await bancas.buscarPorAluno(req.aluno.usuario_id);
        const salva = await bancas.salvar(req.aluno.usuario_id, req.session.user, valores);
        const banca = await bancas.buscarPorAluno(req.aluno.usuario_id);
        let mensagem = salva.situacao === 'remarcada' ? 'Banca remarcada. O novo horário já está na agenda e na área do estudante.' : 'Agendamento salvo. A banca já aparece na agenda e na área do estudante.';

        // avisa por e-mail (com convite de calendário) quando a banca é nova,
        // volta de um cancelamento ou muda algo que interessa aos participantes
        const mudou = !antes || antes.situacao === 'cancelada'
            || CAMPOS_DO_CONVITE.some((campo) => String(antes[campo] ?? '') !== String(banca[campo] ?? ''));
        if (mudou) {
            const novos = !antes || antes.situacao === 'cancelada';
            const envio = await notificarBanca(banca, novos ? 'agendada' : 'remarcada');
            // quem saiu da banca recebe o cancelamento do evento antigo
            if (antes && !novos) {
                const atuais = new Set(participantesDaBanca(banca).map((p) => p.email));
                const removidos = participantesDaBanca(antes).filter((p) => !atuais.has(p.email));
                if (removidos.length) await notificarBanca(antes, 'removido', removidos);
            }
            mensagem += envio.ok ? ' Os participantes foram avisados por e-mail, com convite para a agenda.' : AVISO_SEM_EMAIL;
        }
        setFlash(req, 'success', mensagem);
        res.redirect('/professor/bancas');
    } catch (e) {
        if (!e.status) throw e;
        return renderizar(req, res.status(e.status), valores, [e.message]);
    }
});
router.post('/aluno/:id/banca/situacao', carregar, async (req, res) => {
    if (!/^\d+$/.test(String(req.body.versao ?? ''))) return res.status(400).send('Atualize a página antes de continuar.');
    try {
        await bancas.definirSituacao(req.aluno.usuario_id, req.session.user, Number(req.body.versao), req.body.situacao);
        let mensagem = req.body.situacao === 'cancelada' ? 'Banca cancelada. Sala e participantes liberados neste horário.' : 'Banca marcada como realizada. O encerramento do estágio continua sendo feito pela ata.';
        if (req.body.situacao === 'cancelada') {
            const envio = await notificarBanca(await bancas.buscarPorAluno(req.aluno.usuario_id), 'cancelada');
            mensagem += envio.ok ? ' Os participantes foram avisados por e-mail.' : AVISO_SEM_EMAIL;
        }
        setFlash(req, 'success', mensagem);
        res.redirect('/professor/bancas');
    } catch (e) {
        if (!e.status) throw e;
        return renderizar(req, res.status(e.status), null, [e.message]);
    }
});
module.exports = router;
