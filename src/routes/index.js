const router = require('express').Router();

router.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect(req.session.user.tipo === 'professor' ? '/professor/dashboard' : '/aluno/dashboard');
    }
    res.redirect('/login');
});

module.exports = router;
