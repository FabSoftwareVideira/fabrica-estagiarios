const router = require('express').Router();
const path = require('path');

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/users.html'));
});

router.post('/create', (req, res) => {
    const { name, email } = req.body;
    // Aqui você pode adicionar a lógica para criar um usuário no banco de dados
    res.json({ message: `Usuário ${name} com email ${email} criado com sucesso!` });
});

module.exports = router;