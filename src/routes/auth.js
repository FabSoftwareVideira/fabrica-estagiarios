const router = require('express').Router();
const crypto = require('crypto');
const usuarios = require('../models/usuarios');
const professores = require('../models/professores');
const { setFlash } = require('../middleware/auth');
const { DOMINIO_PROFESSOR, ADMIN_PRINCIPAL_EMAIL } = require('../config/constants');

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL;

function tipoPorEmail(email) {
    const lower = (email || '').toLowerCase();
    return lower.endsWith(DOMINIO_PROFESSOR) ? 'professor' : 'aluno';
}

router.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect(req.session.user.tipo === 'professor' ? '/professor/dashboard' : '/aluno/dashboard');
    }
    res.render('login');
});

// Passo 1: manda pro GitHub autorizar
router.get('/auth/github', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;

    const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: GITHUB_CALLBACK_URL,
        scope: 'read:user user:email',
        state,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// Passo 2: callback do GitHub — troca o code, busca o perfil/e-mail e loga
router.get('/auth/github/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code || !state || state !== req.session.oauthState) {
        setFlash(req, 'error', 'Falha na autenticação com o GitHub. Tente novamente.');
        return res.redirect('/login');
    }
    delete req.session.oauthState;

    try {
        const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code,
                redirect_uri: GITHUB_CALLBACK_URL,
            }),
        });
        const tokenData = await tokenResp.json();

        if (!tokenData.access_token) {
            console.error('[auth/github/callback] sem access_token:', tokenData);
            setFlash(req, 'error', 'Não foi possível concluir o login com o GitHub.');
            return res.redirect('/login');
        }

        const authHeaders = {
            Authorization: `Bearer ${tokenData.access_token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'fabrica-estagiarios',
        };

        const perfilResp = await fetch('https://api.github.com/user', { headers: authHeaders });
        const perfil = await perfilResp.json();

        // o /user só traz e-mail se for público, então busca a lista completa
        const emailsResp = await fetch('https://api.github.com/user/emails', { headers: authHeaders });
        const emails = await emailsResp.json();
        const emailPrincipal = Array.isArray(emails)
            ? (emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails[0])
            : null;

        if (!emailPrincipal || !emailPrincipal.email) {
            setFlash(req, 'error', 'Sua conta do GitHub precisa ter um e-mail verificado e acessível.');
            return res.redirect('/login');
        }

        const email = emailPrincipal.email.toLowerCase();
        const githubId = perfil.id;
        const nome = perfil.name || perfil.login;
        const avatarUrl = perfil.avatar_url;

        // 1) já existe conta vinculada a esse github_id?
        let usuario = await usuarios.buscarPorGithubId(githubId);

        // 2) senão, existe conta com esse e-mail ainda sem github_id? (ex.: seed do admin)
        if (!usuario) {
            const porEmail = await usuarios.buscarPorEmail(email);
            if (porEmail) {
                usuario = await usuarios.vincularGithubId(porEmail.id, githubId, avatarUrl);
            }
        }

        // 3) senão, cria conta nova
        if (!usuario) {
            const tipo = tipoPorEmail(email);
            usuario = await usuarios.criar({ nome, email, tipo, githubId, avatarUrl });

            if (tipo === 'professor') {
                const ehAdminPrincipal = email === ADMIN_PRINCIPAL_EMAIL.toLowerCase();
                await professores.criar({ usuarioId: usuario.id, cargo: ehAdminPrincipal ? 'admin' : 'comum' });
            }
            // aluno: a linha em "alunos" só é criada em /aluno/completar-cadastro
            // (precisa da matrícula, que o GitHub não fornece)
        }

        let cargo = null;
        if (usuario.tipo === 'professor') {
            const professor = await professores.buscarPorUsuarioId(usuario.id);
            cargo = professor ? professor.cargo : 'comum';
        }

        req.session.user = { id: usuario.id, nome: usuario.nome, email: usuario.email, tipo: usuario.tipo, cargo };

        if (usuario.tipo === 'professor') {
            return res.redirect('/professor/dashboard');
        }
        // requireAlunoCompleto cuida de redirecionar pra completar-cadastro se faltar matrícula
        res.redirect('/aluno/dashboard');
    } catch (err) {
        console.error('[auth/github/callback] erro:', err.message);
        setFlash(req, 'error', 'Erro ao autenticar com o GitHub. Tente novamente.');
        res.redirect('/login');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
