const router = require('express').Router();
const { requireRole, requireEmAndamento, requireAlunoCompleto, setFlash } = require('../middleware/auth');
const alunosModel = require('../models/alunos');
const atividadesModel = require('../models/atividades');
const usuariosModel = require('../models/usuarios');

router.use(requireRole('aluno'));

// completar-cadastro fica ANTES do requireAlunoCompleto de propósito:
// é justamente a rota que resolve a pendência dele.
router.get('/completar-cadastro', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.session.user.id);
    if (aluno) return res.redirect('/aluno/dashboard'); // já completou, não deixa preencher de novo
    res.render('aluno_completar_cadastro', { nomeAtual: req.session.user.nome });
});

router.post('/completar-cadastro', async (req, res) => {
    const matricula = (req.body.matricula || '').trim();
    const nome = (req.body.nome || '').trim();
    if (!matricula || !nome) {
        setFlash(req, 'error', 'Informe seu nome completo e sua matrícula.');
        return res.redirect('/aluno/completar-cadastro');
    }
    try {
        // o GitHub nem sempre devolve o nome completo (às vezes só o primeiro
        // nome/login), então aproveitamos essa telinha pra confirmar/corrigir
        await usuariosModel.confirmarNome(req.session.user.id, nome);
        req.session.user.nome = nome;

        await alunosModel.criar({ usuarioId: req.session.user.id, matricula });
        setFlash(req, 'success', 'Cadastro concluído! Você entrará na lista de espera até a aprovação de um professor.');
        res.redirect('/aluno/dashboard');
    } catch (err) {
        if (err.code === '23505') {
            setFlash(req, 'error', 'Essa matrícula já está cadastrada.');
        } else {
            console.error('[aluno/completar-cadastro] erro:', err.message);
            setFlash(req, 'error', 'Não foi possível concluir o cadastro. Tente novamente.');
        }
        res.redirect('/aluno/completar-cadastro');
    }
});

router.use(requireAlunoCompleto);

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
