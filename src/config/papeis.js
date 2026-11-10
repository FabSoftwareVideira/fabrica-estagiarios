// Papéis de quem entra pela área /professor (usuarios.tipo = 'professor'),
// guardados em professores.cargo:
//   comum      professor: vê os estudantes que orienta ou supervisiona
//   admin      professor administrador: vê todos e gerencia usuários
//   servidor   setor de estágios (não é professor): vê todos os estudantes e o
//              acompanhamento, mas não orienta, não supervisiona nem avalia
//   supervisor supervisor externo: vê só os supervisionados
const ROTULOS_CARGO = {
    comum: 'Professor / orientador',
    admin: 'Professor / orientador',
    servidor: 'Servidor (setor de estágios)',
    supervisor: 'Supervisor externo',
};

// Quem enxerga todos os estágios, e não só os próprios.
function veTodosOsEstagios(user) {
    return Boolean(user) && ['admin', 'servidor'].includes(user.cargo);
}

// Quem pode ser orientador, supervisor interno ou avaliador de banca.
function podeOrientar(cargo) {
    return cargo === 'comum' || cargo === 'admin';
}

module.exports = { ROTULOS_CARGO, veTodosOsEstagios, podeOrientar };
