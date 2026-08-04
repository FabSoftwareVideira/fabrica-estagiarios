const router = require('express').Router();
const { requireRole, requireEmAndamento, setFlash } = require('../middleware/auth');
const alunosModel = require('../models/alunos');
const atividadesModel = require('../models/atividades');

router.use(requireRole('aluno'));

router.get('/dashboard', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.session.user.id);
    const ultimaAtividade = await atividadesModel.ultimaPorAluno(req.session.user.id);

    const horasRealizadas = Number(aluno.horas_realizadas);
    const cargaHoraria = aluno.carga_horaria;
    const percentual = cargaHoraria > 0 ? Math.min(100, Math.round((horasRealizadas / cargaHoraria) * 100)) : 0;

    res.render('aluno_dashboard', {
        aluno,
        ultimaAtividade,
        horasRealizadas,
        cargaHoraria,
        horasRestantes: Math.max(0, cargaHoraria - horasRealizadas),
        percentual,
    });
});

router.get('/atividades', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.session.user.id);
    const atividades = await atividadesModel.listarPorAluno(req.session.user.id);

    const horasRealizadas = Number(aluno.horas_realizadas);
    const cargaHoraria = aluno.carga_horaria;
    const percentual = cargaHoraria > 0 ? Math.min(100, Math.round((horasRealizadas / cargaHoraria) * 100)) : 0;

    res.render('aluno_atividades', {
        atividades,
        horasRealizadas,
        cargaHoraria,
        percentual,
        status: aluno.status,
    });
});

// só acessível com o estágio em andamento (lista de espera / concluído são bloqueados)
router.get('/nova-atividade', requireEmAndamento, (req, res) => {
    res.render('aluno_nova_atividade');
});

router.post('/nova-atividade', requireEmAndamento, async (req, res) => {
    const { data, horas, descricao } = req.body;

    if (!data || !horas || !descricao) {
        setFlash(req, 'error', 'Preencha todos os campos da atividade.');
        return res.redirect('/aluno/nova-atividade');
    }

    await atividadesModel.criar({
        alunoId: req.session.user.id,
        data,
        horas: Number(horas),
        descricao: descricao.trim(),
    });

    setFlash(req, 'success', 'Atividade registrada com sucesso.');
    res.redirect('/aluno/atividades');
});

module.exports = router;
