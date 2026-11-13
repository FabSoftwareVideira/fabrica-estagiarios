const router = require('express').Router();

router.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect(req.session.user.tipo === 'professor' ? '/professor/dashboard' : '/aluno/dashboard');
    }
    res.render('login');
});

// Aviso de privacidade e cookies (LGPD): público, inclusive para quem ainda não entrou
router.get('/privacidade', (req, res) => res.render('privacidade'));

module.exports = router;
