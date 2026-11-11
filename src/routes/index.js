const router = require('express').Router();
const { loginGithubHabilitado } = require('../config/login');

router.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect(req.session.user.tipo === 'professor' ? '/professor/dashboard' : '/aluno/dashboard');
    }
    res.render('login', { loginGithub: loginGithubHabilitado() });
});

module.exports = router;
