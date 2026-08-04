const router = require('express').Router();
const bcrypt = require('bcryptjs');
const usuarios = require('../models/usuarios');
const alunos = require('../models/alunos');
const professores = require('../models/professores');
const { setFlash } = require('../middleware/auth');

const DOMINIO_ALUNO = '@estudantes.ifc.edu.br';
const DOMINIO_PROFESSOR = '@ifc.edu.br';

function tipoPorEmail(email) {
    const lower = (email || '').toLowerCase();
    if (lower.endsWith(DOMINIO_ALUNO)) return 'aluno';
    if (lower.endsWith(DOMINIO_PROFESSOR)) return 'professor';
    return null;
}

router.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect(req.session.user.tipo === 'professor' ? '/professor/dashboard' : '/aluno/dashboard');
    }
    res.render('login');
});

router.post('/login', async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const senha = req.body.senha || '';

    const usuario = await usuarios.buscarPorEmail(email);

    if (!usuario || !(await bcrypt.compare(senha, usuario.senha_hash))) {
        setFlash(req, 'error', 'E-mail ou senha inválidos.');
        return res.redirect('/login');
    }

    let cargo = null;
    if (usuario.tipo === 'professor') {
        const professor = await professores.buscarPorUsuarioId(usuario.id);
        if (!professor || !professor.confirmado) {
            setFlash(req, 'error', 'Seu cadastro ainda não foi confirmado por um administrador.');
            return res.redirect('/login');
        }
        cargo = professor.cargo;
    }

    req.session.user = { id: usuario.id, nome: usuario.nome, email: usuario.email, tipo: usuario.tipo, cargo };
    res.redirect(usuario.tipo === 'professor' ? '/professor/dashboard' : '/aluno/dashboard');
});

router.get('/cadastro', (req, res) => {
    res.render('cadastro');
});

router.get('/cadastro/aluno', (req, res) => {
    res.render('cadastro_aluno');
});

router.post('/cadastro/aluno', async (req, res) => {
    const nome = (req.body.nome || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const matricula = (req.body.matricula || '').trim();
    const { senha, confirmar_senha } = req.body;

    if (!nome || !email || !matricula || !senha) {
        setFlash(req, 'error', 'Preencha todos os campos.');
        return res.redirect('/cadastro/aluno');
    }
    if (tipoPorEmail(email) !== 'aluno') {
        setFlash(req, 'error', 'Use seu e-mail institucional de aluno (@estudantes.ifc.edu.br).');
        return res.redirect('/cadastro/aluno');
    }
    if (senha.length < 6) {
        setFlash(req, 'error', 'A senha deve ter pelo menos 6 caracteres.');
        return res.redirect('/cadastro/aluno');
    }
    if (senha !== confirmar_senha) {
        setFlash(req, 'error', 'As senhas não coincidem.');
        return res.redirect('/cadastro/aluno');
    }

    try {
        const senhaHash = await bcrypt.hash(senha, 10);
        const usuario = await usuarios.criar({ nome, email, tipo: 'aluno', senhaHash });
        await alunos.criar({ usuarioId: usuario.id, matricula });

        setFlash(req, 'success', 'Cadastro enviado! Você entrará na lista de espera até a aprovação de um professor.');
        res.redirect('/login');
    } catch (err) {
        if (err.code === '23505') {
            setFlash(req, 'error', 'E-mail ou matrícula já cadastrados.');
        } else {
            console.error('[cadastro/aluno] erro:', err.message);
            setFlash(req, 'error', 'Não foi possível concluir o cadastro. Tente novamente.');
        }
        res.redirect('/cadastro/aluno');
    }
});

router.get('/cadastro/professor', (req, res) => {
    res.render('cadastro_professor');
});

router.post('/cadastro/professor', async (req, res) => {
    const nome = (req.body.nome || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const { senha, confirmar_senha } = req.body;

    if (!nome || !email || !senha) {
        setFlash(req, 'error', 'Preencha todos os campos.');
        return res.redirect('/cadastro/professor');
    }
    if (tipoPorEmail(email) !== 'professor') {
        setFlash(req, 'error', 'Use seu e-mail institucional de professor (@ifc.edu.br).');
        return res.redirect('/cadastro/professor');
    }
    if (senha.length < 6) {
        setFlash(req, 'error', 'A senha deve ter pelo menos 6 caracteres.');
        return res.redirect('/cadastro/professor');
    }
    if (senha !== confirmar_senha) {
        setFlash(req, 'error', 'As senhas não coincidem.');
        return res.redirect('/cadastro/professor');
    }

    try {
        const senhaHash = await bcrypt.hash(senha, 10);
        const usuario = await usuarios.criar({ nome, email, tipo: 'professor', senhaHash });
        // cargo "comum" e não confirmado por padrão -> precisa de aprovação
        // de um admin na Lista de Professores antes de conseguir logar
        await professores.criar({ usuarioId: usuario.id, cargo: 'comum', confirmado: false });

        setFlash(req, 'success', 'Cadastro enviado! Aguarde a confirmação de um administrador para poder acessar.');
        res.redirect('/login');
    } catch (err) {
        if (err.code === '23505') {
            setFlash(req, 'error', 'Já existe um cadastro com esse e-mail.');
        } else {
            console.error('[cadastro/professor] erro:', err.message);
            setFlash(req, 'error', 'Não foi possível concluir o cadastro. Tente novamente.');
        }
        res.redirect('/cadastro/professor');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
