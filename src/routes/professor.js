const router = require('express').Router();
const { requireRole, requireAdmin, requireNomeConfirmado, setFlash } = require('../middleware/auth');
const alunosModel = require('../models/alunos');
const atividadesModel = require('../models/atividades');
const usuariosModel = require('../models/usuarios');
const professoresModel = require('../models/professores');
const { ADMIN_PRINCIPAL_EMAIL } = require('../config/constants');

router.use(requireRole('professor'));

// completar-cadastro fica ANTES do requireNomeConfirmado de propósito:
// é justamente a rota que resolve a pendência (nome incompleto vindo do GitHub).
router.get('/completar-cadastro', async (req, res) => {
    const usuario = await usuariosModel.buscarPorId(req.session.user.id);
    if (usuario && usuario.nome_confirmado) return res.redirect('/professor/dashboard');
    res.render('professor_completar_cadastro', { nomeAtual: usuario ? usuario.nome : '' });
});

router.post('/completar-cadastro', async (req, res) => {
    const nome = (req.body.nome || '').trim();
    if (!nome) {
        setFlash(req, 'error', 'Informe seu nome completo.');
        return res.redirect('/professor/completar-cadastro');
    }
    const usuario = await usuariosModel.confirmarNome(req.session.user.id, nome);
    req.session.user.nome = usuario.nome;
    setFlash(req, 'success', 'Nome confirmado com sucesso.');
    res.redirect('/professor/dashboard');
});

router.use(requireNomeConfirmado);

router.get('/dashboard', async (req, res) => {
    const [listaEspera, emAndamento, concluidos, contagem] = await Promise.all([
        alunosModel.listarPorStatus('lista_espera'),
        alunosModel.listarPorStatus('em_andamento'),
        alunosModel.listarPorStatus('concluido'),
        alunosModel.contarPorStatus(),
    ]);

    res.render('professor_dashboard', { listaEspera, emAndamento, concluidos, contagem });
});

router.get('/aluno/:id', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Aluno não encontrado.');
        return res.redirect('/professor/dashboard');
    }

    const [atividades, professores] = await Promise.all([
        atividadesModel.listarPorAluno(req.params.id),
        usuariosModel.listarProfessores(),
    ]);

    res.render('professor_aluno', { aluno, atividades, professores });
});

router.post('/aluno/:id', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Aluno não encontrado.');
        return res.redirect('/professor/dashboard');
    }
    if (aluno.arquivado) {
        setFlash(req, 'error', 'Não é possível editar um estágio arquivado. Desarquive primeiro.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    const { status, supervisor_id, orientador_id, carga_horaria } = req.body;

    if (supervisor_id && orientador_id && supervisor_id === orientador_id) {
        setFlash(req, 'error', 'Supervisor e orientador não podem ser o mesmo professor.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    await alunosModel.atualizarEstagio(req.params.id, {
        status,
        supervisorId: supervisor_id || null,
        orientadorId: orientador_id || null,
        cargaHoraria: Number(carga_horaria),
    });

    setFlash(req, 'success', 'Estágio atualizado com sucesso.');
    res.redirect('/professor/aluno/' + req.params.id);
});

router.get('/cadastro-aluno/:id', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno || aluno.status !== 'lista_espera') {
        setFlash(req, 'error', 'Solicitação não encontrada ou já avaliada.');
        return res.redirect('/professor/dashboard');
    }

    const professores = await usuariosModel.listarProfessores();
    res.render('professor_cadastro_aluno', { aluno, professores });
});

router.post('/cadastro-aluno/:id', async (req, res) => {
    const { supervisor_id, orientador_id, carga_horaria } = req.body;

    if (!supervisor_id || !orientador_id || !carga_horaria) {
        setFlash(req, 'error', 'Preencha supervisor, orientador e carga horária.');
        return res.redirect('/professor/cadastro-aluno/' + req.params.id);
    }

    if (supervisor_id === orientador_id) {
        setFlash(req, 'error', 'Supervisor e orientador não podem ser o mesmo professor.');
        return res.redirect('/professor/cadastro-aluno/' + req.params.id);
    }

    await alunosModel.atualizarEstagio(req.params.id, {
        status: 'em_andamento',
        supervisorId: supervisor_id,
        orientadorId: orientador_id,
        cargaHoraria: Number(carga_horaria),
    });

    setFlash(req, 'success', 'Cadastro aprovado! O aluno já pode registrar atividades.');
    res.redirect('/professor/dashboard');
});

// ── Arquivados ────────────────────────────────────────────────────────────
// Arquivar/desarquivar: qualquer professor (comum ou admin).
// Excluir definitivamente: só admin.

router.get('/arquivados', async (req, res) => {
    const busca = req.query.q || '';
    const arquivados = await alunosModel.listarArquivados(busca);
    res.render('professor_arquivados', { arquivados, busca });
});

router.post('/aluno/:id/arquivar', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno || aluno.arquivado || aluno.status === 'concluido') {
        setFlash(req, 'error', 'Esse aluno não pode ser arquivado.');
        return res.redirect(req.headers.referer || '/professor/dashboard');
    }
    await alunosModel.arquivar(req.params.id);
    setFlash(req, 'success', 'Aluno arquivado com sucesso.');
    res.redirect(req.headers.referer || '/professor/dashboard');
});

router.post('/aluno/:id/desarquivar', async (req, res) => {
    await alunosModel.desarquivar(req.params.id);
    setFlash(req, 'success', 'Aluno desarquivado com sucesso.');
    res.redirect('/professor/arquivados');
});

router.post('/aluno/:id/excluir', requireAdmin, async (req, res) => {
    await alunosModel.excluir(req.params.id);
    setFlash(req, 'success', 'Aluno excluído definitivamente.');
    res.redirect('/professor/arquivados');
});

// ── Lista de Professores (só admin) ──────────────────────────────────────
// req.session.user nunca aparece na própria lista (não faz sentido se
// confirmar/promover/excluir sozinho).

router.get('/professores', requireAdmin, async (req, res) => {
    const lista = await professoresModel.listarExceto(req.session.user.id);
    res.render('professor_lista', { professores: lista, ADMIN_PRINCIPAL_EMAIL });
});

router.post('/professores/:id/cargo', requireAdmin, async (req, res) => {
    if (Number(req.params.id) === req.session.user.id) {
        return res.redirect('/professor/professores');
    }
    const cargo = req.body.cargo === 'admin' ? 'admin' : 'comum';
    await professoresModel.definirCargo(req.params.id, cargo);
    setFlash(req, 'success', 'Cargo atualizado com sucesso.');
    res.redirect('/professor/professores');
});

router.post('/professores/:id/excluir', requireAdmin, async (req, res) => {
    if (Number(req.params.id) === req.session.user.id) {
        setFlash(req, 'error', 'Você não pode excluir a própria conta.');
        return res.redirect('/professor/professores');
    }

    const alvo = await professoresModel.buscarPorUsuarioId(req.params.id);
    if (alvo && alvo.email.toLowerCase() === ADMIN_PRINCIPAL_EMAIL.toLowerCase()) {
        setFlash(req, 'error', 'Esta conta é o administrador principal e não pode ser excluída.');
        return res.redirect('/professor/professores');
    }

    await professoresModel.excluir(req.params.id);
    setFlash(req, 'success', 'Professor excluído com sucesso.');
    res.redirect('/professor/professores');
});

module.exports = router;
