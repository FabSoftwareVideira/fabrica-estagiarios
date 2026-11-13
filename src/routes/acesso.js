const router = require('express').Router();
const { requireAuth, setFlash, iniciarSessao } = require('../middleware/auth');
const alunosModel = require('../models/alunos');
const professoresModel = require('../models/professores');
const usuariosModel = require('../models/usuarios');
const { DOMINIO_PROFESSOR } = require('../config/constants');

async function carregarSolicitante(req, res, next) {
    const usuario = await usuariosModel.buscarPorId(req.session.user.id);
    if (!usuario || usuario.tipo !== 'aluno' || usuario.email.toLowerCase().endsWith(DOMINIO_PROFESSOR)) {
        return res.redirect(usuario && usuario.tipo === 'professor' ? '/professor/dashboard' : '/aluno/dashboard');
    }

    const aluno = await alunosModel.buscarPorUsuarioId(usuario.id);
    if (aluno) return res.redirect('/aluno/dashboard');

    req.usuario = usuario;
    next();
}

router.get('/perfil', requireAuth, carregarSolicitante, (req, res) => {
    res.render('acesso_perfil');
});

router.post('/perfil', requireAuth, carregarSolicitante, async (req, res) => {
    const tipo = req.body.tipo;
    if (tipo === 'aluno') return res.redirect('/aluno/dashboard');
    if (tipo !== 'supervisor') {
        setFlash(req, 'error', 'Escolha se deseja continuar como estudante ou solicitar acesso como supervisor externo.');
        return res.redirect('/acesso/perfil');
    }

    const empresa = String(req.body.empresa || '').trim();
    const funcao = String(req.body.funcao || '').trim();
    if (!empresa || empresa.length > 200 || !funcao || funcao.length > 150) {
        setFlash(req, 'error', 'Informe a empresa e sua função, respeitando os limites indicados.');
        return res.redirect('/acesso/perfil');
    }

    const criado = await professoresModel.solicitarAcessoSupervisor(req.usuario.id, empresa, funcao);
    if (!criado) {
        setFlash(req, 'error', 'Não foi possível registrar a solicitação. Entre com o acesso já associado a essa conta ou peça ajuda a um professor.');
        return res.redirect('/acesso/perfil');
    }

    // a conta mudou de perfil: sessão nova
    await iniciarSessao(req, {
        id: req.usuario.id,
        nome: req.usuario.nome,
        email: req.usuario.email,
        tipo: 'professor',
        cargo: 'supervisor',
        supervisorAprovado: false,
        avatarEmoji: req.usuario.avatar_emoji || null,
    });
    res.redirect('/supervisor/pendente');
});

module.exports = router;
