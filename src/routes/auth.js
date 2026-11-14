const router = require('express').Router();
const crypto = require('crypto');
const usuarios = require('../models/usuarios');
const alunos = require('../models/alunos');
const professores = require('../models/professores');
const { requireAuth, setFlash, iniciarSessao } = require('../middleware/auth');
const { DOMINIO_PROFESSOR, ADMIN_PRINCIPAL_EMAIL } = require('../config/constants');
const avatares = require('../config/avatares');
const { CURSOS, ehCurso } = require('../config/cursos');
const { lerMatricula, MENSAGEM_MATRICULA } = require('../utils/matricula');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;

function tipoPorEmail(email) {
    const lower = (email || '').toLowerCase();
    return lower.endsWith(DOMINIO_PROFESSOR) ? 'professor' : 'aluno';
}

router.get('/login', (req, res) => {
    if (req.session.user) {
        if (req.session.user.cargo === 'supervisor' && !req.session.user.supervisorAprovado) {
            return res.redirect('/supervisor/pendente');
        }
        return res.redirect(req.session.user.tipo === 'professor' ? '/professor/inicio' : '/aluno/dashboard');
    }
    res.redirect('/');
});

router.get('/perfil', requireAuth, async (req, res) => {
    const usuario = await usuarios.buscarPorId(req.session.user.id);
    req.session.user.avatarEmoji = usuario.avatar_emoji || null;
    const aluno = usuario.tipo === 'aluno' ? await alunos.buscarPorUsuarioId(usuario.id) : null;
    const professor = usuario.tipo === 'professor'
        ? await professores.buscarPorUsuarioId(usuario.id)
        : null;
    res.render('perfil', { usuario, aluno, professor, avatares, cursos: CURSOS });
});

router.post('/perfil', requireAuth, async (req, res) => {
    const nome = String(req.body.nome ?? '').trim();
    const { valida: matriculaValida, valor: matricula } = lerMatricula(req.body.matricula);
    const curso = typeof req.body.curso === 'string' ? req.body.curso : '';
    const avatarEmoji = (typeof req.body.avatarEmoji === 'string' ? req.body.avatarEmoji.trim() : '') || null;

    if (!nome || nome.length > 150) {
        setFlash(req, 'error', 'Informe seu nome completo, com até 150 caracteres.');
        return res.redirect('/perfil');
    }

    if (avatarEmoji && !avatares.some((avatar) => avatar.emoji === avatarEmoji)) {
        setFlash(req, 'error', 'Escolha um avatar da lista ou fique sem avatar.');
        return res.redirect('/perfil');
    }
    if (req.session.user.tipo === 'aluno' && !matriculaValida) {
        setFlash(req, 'error', MENSAGEM_MATRICULA);
        return res.redirect('/perfil');
    }
    if (req.session.user.tipo === 'aluno' && !ehCurso(curso)) {
        setFlash(req, 'error', 'Selecione um dos cursos técnicos disponíveis.');
        return res.redirect('/perfil');
    }

    try {
        if (req.session.user.tipo === 'aluno') {
            const aluno = await alunos.buscarPorUsuarioId(req.session.user.id);
            if (aluno && matricula) {
                const matriculaExistente = await alunos.buscarPorMatricula(matricula);
                if (matriculaExistente && matriculaExistente.usuario_id !== req.session.user.id) {
                    setFlash(req, 'error', 'Essa matrícula já está cadastrada.');
                    return res.redirect('/perfil');
                }
            }
        }

        const usuario = await usuarios.atualizarPerfil(req.session.user.id, nome);
        req.session.user.nome = usuario.nome;

        await usuarios.atualizarAvatar(req.session.user.id, avatarEmoji);
        req.session.user.avatarEmoji = avatarEmoji;

        // caixa desmarcada não é enviada pelo navegador: ausente = não receber.
        // O lembrete de atividades só existe para estudantes; para os demais fica ligado.
        await usuarios.definirPreferenciasEmail(req.session.user.id, {
            bancas: req.body.receber_email_bancas === 'on',
            lembretes: req.session.user.tipo === 'aluno' ? req.body.receber_lembretes_atividades === 'on' : true,
        });

        if (req.session.user.tipo === 'aluno') {
            const aluno = await alunos.buscarPorUsuarioId(req.session.user.id);
            if (aluno) {
                await alunos.atualizarMatricula(req.session.user.id, matricula);
                await alunos.atualizarCurso(req.session.user.id, curso);
            }
        } else {
            await professores.definirRecebimentoRelatorio(
                req.session.user.id,
                req.body.receber_relatorio_semanal === 'on'
            );
        }

        setFlash(req, 'success', 'Perfil atualizado com sucesso.');
    } catch (err) {
        if (err.code === '23505') {
            setFlash(req, 'error', 'Essa matrícula já está cadastrada.');
        } else {
            console.error('[perfil] erro:', err.message);
            setFlash(req, 'error', 'Não foi possível atualizar o perfil.');
        }
    }
    res.redirect('/perfil');
});

router.get('/auth/google', (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
        setFlash(req, 'error', 'Login com Google ainda não foi configurado.');
        return res.redirect('/login');
    }

    const state = crypto.randomBytes(16).toString('hex');
    req.session.googleOauthState = state;

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_CALLBACK_URL,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'online',
    });

    req.session.save((err) => {
        if (err) {
            console.error('[auth/google] erro ao salvar sessão:', err.message);
            setFlash(req, 'error', 'Não foi possível iniciar o login com o Google. Tente novamente.');
            return res.redirect('/login');
        }
        res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    });
});

router.get('/auth/google/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code || !state || state !== req.session.googleOauthState) {
        delete req.session.googleOauthState;
        setFlash(req, 'error', 'Falha na autenticação com o Google. Tente novamente.');
        return res.redirect('/login');
    }
    delete req.session.googleOauthState;

    try {
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: GOOGLE_CALLBACK_URL,
            }),
        });
        const tokenData = await tokenResp.json();

        if (!tokenResp.ok || !tokenData.access_token) {
            console.error('[auth/google/callback] sem access_token:', tokenData);
            setFlash(req, 'error', 'Não foi possível concluir o login com o Google.');
            return res.redirect('/login');
        }

        const perfilResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const perfil = await perfilResp.json();

        if (!perfilResp.ok || !perfil.sub || !perfil.email || !perfil.email_verified) {
            setFlash(req, 'error', 'Sua conta do Google precisa ter um e-mail verificado e acessível.');
            return res.redirect('/login');
        }

        const email = perfil.email.toLowerCase();
        const googleId = perfil.sub;
        const nome = perfil.name || email.split('@')[0];
        const avatarUrl = perfil.picture || null;

        let usuario = await usuarios.buscarPorGoogleId(googleId);
        if (!usuario) {
            const porEmail = await usuarios.buscarPorEmail(email);
            if (porEmail) {
                if (!porEmail.ativo) {
                    setFlash(req, 'error', 'Esta conta foi desativada. Entre em contato com a instituição.');
                    return res.redirect('/login');
                }
                // só vincula conta que ainda não tem Google: um e-mail igual não
                // basta para assumir uma conta já ligada a outra pessoa
                usuario = await usuarios.vincularGoogleId(porEmail.id, googleId, avatarUrl);
                if (!usuario) {
                    console.warn('[auth/google/callback] e-mail já vinculado a outra conta Google: usuário', porEmail.id);
                    setFlash(req, 'error', 'Este e-mail já está vinculado a outra conta Google. Procure o setor de estágios para atualizar o cadastro.');
                    return res.redirect('/login');
                }
            }
        }

        if (!usuario) {
            const tipo = tipoPorEmail(email);
            usuario = await usuarios.criar({ nome, email, tipo, googleId, avatarUrl });

            if (tipo === 'professor') {
                const ehAdminPrincipal = email === ADMIN_PRINCIPAL_EMAIL.toLowerCase();
                await professores.criar({ usuarioId: usuario.id, cargo: ehAdminPrincipal ? 'admin' : 'comum' });
            }
        }

        if (!usuario.ativo) {
            setFlash(req, 'error', 'Esta conta foi desativada. Entre em contato com a instituição.');
            return res.redirect('/login');
        }

        let cargo = null;
        let supervisorAprovado = true;
        if (usuario.tipo === 'professor') {
            const professor = await professores.buscarPorUsuarioId(usuario.id);
            cargo = professor ? professor.cargo : 'comum';
            supervisorAprovado = professor ? professor.aprovado : true;
        }

        await iniciarSessao(req, {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            tipo: usuario.tipo,
            cargo,
            supervisorAprovado,
            avatarEmoji: usuario.avatar_emoji || null,
        });

        if (usuario.tipo === 'professor') {
            if (cargo === 'supervisor' && !supervisorAprovado) {
                return res.redirect('/supervisor/pendente');
            }
            return res.redirect('/professor/inicio');
        }
        const emailConta = usuario.email.toLowerCase();
        if (!emailConta.endsWith(DOMINIO_PROFESSOR) && !await alunos.buscarPorUsuarioId(usuario.id)) {
            return res.redirect('/acesso/perfil');
        }
        res.redirect('/aluno/dashboard');
    } catch (err) {
        console.error('[auth/google/callback] erro:', err.message);
        setFlash(req, 'error', 'Erro ao autenticar com o Google. Tente novamente.');
        res.redirect('/login');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
