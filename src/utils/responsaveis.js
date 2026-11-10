// Confere orientador e supervisor escolhidos para um estágio.
const professoresModel = require('../models/professores');
const { papeisDoPerfil } = require('../config/papeis');

// Devolve a mensagem de erro, ou null quando a combinação é válida.
async function validarResponsaveis(supervisorId, orientadorId) {
    const [supervisor, orientador] = await Promise.all([
        supervisorId ? professoresModel.buscarPorUsuarioId(supervisorId) : null,
        orientadorId ? professoresModel.buscarPorUsuarioId(orientadorId) : null,
    ]);

    if (supervisorId && (!supervisor || !supervisor.aprovado || !papeisDoPerfil(supervisor).supervisor)) {
        return 'Selecione um supervisor aprovado.';
    }
    if (orientadorId && (!orientador || !orientador.aprovado || orientador.cargo === 'supervisor' || !papeisDoPerfil(orientador).orientador)) {
        return 'O orientador deve ser um professor da instituição.';
    }
    if (supervisorId && orientadorId && Number(supervisorId) === Number(orientadorId)) {
        return 'Supervisor e orientador não podem ser a mesma pessoa.';
    }
    return null;
}

module.exports = { validarResponsaveis };
