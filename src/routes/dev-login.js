const express = require('express');

const usuariosModel = require('../models/usuarios');
const professoresModel = require('../models/professores');
const { DOMINIO_PROFESSOR } = require('../config/constants');

const router = express.Router();

// Só funciona em desenvolvimento. Em qualquer outro ambiente, a rota
// responde 404 e NÃO autentica ninguém.
function apenasDev(req, res, next) {
    // APP_ENV ausente conta como desenvolvimento (mesmo default de src/app.js)
    if (process.env.APP_ENV && process.env.APP_ENV !== 'development') {
        return res.status(404).send('Not Found');
    }
    next();
}

// Usuários fake usados só em dev. O e-mail do professor termina com
// DOMINIO_PROFESSOR para cair na regra de "tipo por e-mail".
const USUARIOS_DEV = {
    professor: {
        nome: 'Professor de Teste',
        email: `professor.dev${DOMINIO_PROFESSOR}`,
        googleId: 'dev-google-professor',
        avatarUrl: null,
        cargo: 'admin',
    },
    aluno: {
        nome: 'Aluno de Teste',
        email: 'aluno.dev@exemplo.com',
        googleId: 'dev-google-aluno',
        avatarUrl: null,
    },
};

async function entrarComo(tipo, req, res) {
    const dados = USUARIOS_DEV[tipo];

    // 1) acha ou cria o usuário
    let usuario = await usuariosModel.buscarPorEmail(dados.email);
    if (!usuario) {
        usuario = await usuariosModel.criar({
            nome: dados.nome,
            email: dados.email,
            tipo,
            githubId: null,
            googleId: dados.googleId,
            avatarUrl: dados.avatarUrl,
            nomeConfirmado: true,
        });
    }

    // 2) garante a linha na tabela específica (professores)
    if (tipo === 'professor') {
        const existente = await professoresModel.buscarPorUsuarioId(usuario.id);
        if (!existente) {
            await professoresModel.criar({ usuarioId: usuario.id, cargo: dados.cargo });
        }
    }

    // 3) grava na sessão (mesmo formato usado pelo middleware/auth.js)
    const usuarioAtualizado = await usuariosModel.buscarPorId(usuario.id);
    req.session.user = {
        id: usuarioAtualizado.id,
        nome: usuarioAtualizado.nome,
        email: usuarioAtualizado.email,
        tipo: usuarioAtualizado.tipo,
    };

    if (usuarioAtualizado.tipo === 'professor') {
        const prof = await professoresModel.buscarPorUsuarioId(usuarioAtualizado.id);
        req.session.user.cargo = prof ? prof.cargo : 'comum';
        return res.redirect('/professor/dashboard');
    }

    return res.redirect('/aluno/dashboard');
}

router.get('/professor', apenasDev, (req, res) => entrarComo('professor', req, res));
router.get('/aluno', apenasDev, (req, res) => entrarComo('aluno', req, res));

module.exports = router;
