const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const professoresModel = require('../models/professores');

router.get('/pendente', requireAuth, async (req, res) => {
    if (req.session.user.tipo !== 'professor' || req.session.user.cargo !== 'supervisor') {
        return res.redirect(req.session.user.tipo === 'professor' ? '/professor/dashboard' : '/aluno/dashboard');
    }

    const supervisor = await professoresModel.buscarPorUsuarioId(req.session.user.id);
    if (!supervisor || supervisor.cargo !== 'supervisor') {
        return res.redirect('/login');
    }
    if (supervisor.aprovado) {
        req.session.user.supervisorAprovado = true;
        return res.redirect('/professor/dashboard');
    }

    res.render('supervisor_pendente', { supervisor });
});

module.exports = router;
