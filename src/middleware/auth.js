// Middlewares de autenticação e autorização baseados em sessão.
// req.session.user = { id, nome, email, tipo, cargo? } é preenchido em
// src/routes/auth.js após login local (e-mail + senha).

const alunosModel = require('../models/alunos');

async function attachUser(req, res, next) {
    res.locals.user = req.session.user || null;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;

    // usado pelo header pra só mostrar "Nova Atividade" quando o estágio
    // estiver em andamento (a checagem que vale de verdade é o middleware
    // requireEmAndamento nas rotas — isso aqui é só pra não exibir link morto)
    if (req.session.user && req.session.user.tipo === 'aluno') {
        try {
            const aluno = await alunosModel.buscarPorUsuarioId(req.session.user.id);
            res.locals.alunoStatus = aluno ? aluno.status : null;
        } catch (err) {
            res.locals.alunoStatus = null;
        }
    }

    next();
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
}

// role-based access control: cada "tipo" de conta (a "key" aluno/professor)
// só acessa as rotas montadas com o requireRole correspondente.
function requireRole(tipo) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/login');
        }
        if (req.session.user.tipo !== tipo) {
            return res.redirect(
                req.session.user.tipo === 'professor' ? '/professor/dashboard' : '/aluno/dashboard'
            );
        }
        next();
    };
}

// só libera quem é professor E tem cargo "admin" (ex.: gerenciar Lista de Professores)
function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.tipo !== 'professor') {
        return res.redirect('/login');
    }
    if (req.session.user.cargo !== 'admin') {
        setFlash(req, 'error', 'Apenas administradores têm acesso a essa área.');
        return res.redirect('/professor/dashboard');
    }
    next();
}

// só deixa passar se o estágio do aluno logado estiver em andamento
// (bloqueia quem está na lista de espera ou já concluiu)
async function requireEmAndamento(req, res, next) {
    const aluno = await alunosModel.buscarPorUsuarioId(req.session.user.id);

    if (!aluno || aluno.status !== 'em_andamento') {
        setFlash(req, 'error', 'Você só pode registrar atividades enquanto o estágio estiver em andamento.');
        return res.redirect('/aluno/dashboard');
    }

    req.aluno = aluno;
    next();
}

function setFlash(req, type, message) {
    req.session.flash = { type, message };
}

module.exports = { attachUser, requireAuth, requireRole, requireAdmin, requireEmAndamento, setFlash };
