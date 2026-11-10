// Papéis de quem entra pela área /professor (usuarios.tipo = 'professor').
//
// Conta interna (@ifc.edu.br) — os papéis são acumuláveis:
//   admin       professores.cargo = 'admin'   gerencia usuários e vê tudo
//   servidor    professores.papel_servidor    setor de estágios: vê todos os
//                                             estágios pelo Acompanhamento
//   orientador  professores.papel_orientador  pode orientar e avaliar bancas
//   supervisor  professores.papel_supervisor  pode supervisionar estudantes
//
// Supervisor externo — professores.cargo = 'supervisor': conta restrita aos
// próprios supervisionados; não acumula os papéis acima.
const PAPEIS = [
    { chave: 'admin', rotulo: 'Administrador', descricao: 'Gerencia usuários e papéis e vê todos os estágios.' },
    { chave: 'servidor', rotulo: 'Servidor (setor de estágios)', descricao: 'Acompanha todos os estagiários pelo painel de acompanhamento.' },
    { chave: 'orientador', rotulo: 'Orientador', descricao: 'Pode orientar estudantes e avaliar bancas.' },
    { chave: 'supervisor', rotulo: 'Supervisor', descricao: 'Pode supervisionar estudantes e validar atividades.' },
];
const CHAVES_PAPEIS = PAPEIS.map((p) => p.chave);

// Recebe uma linha com cargo e papel_* (professores ou a consulta de acesso).
function papeisDoPerfil(perfil) {
    if (!perfil || !perfil.cargo) return { admin: false, servidor: false, orientador: false, supervisor: false, externo: false };
    if (perfil.cargo === 'supervisor') return { admin: false, servidor: false, orientador: false, supervisor: true, externo: true };
    return {
        admin: perfil.cargo === 'admin',
        servidor: perfil.papel_servidor === true,
        orientador: perfil.papel_orientador !== false,
        supervisor: perfil.papel_supervisor !== false,
        externo: false,
    };
}

const papeisDe = (user) => (user && user.papeis) || {};

// Quem enxerga todos os estágios, e não só os próprios.
function veTodosOsEstagios(user) {
    return Boolean(user) && (user.cargo === 'admin' || papeisDe(user).servidor === true);
}

// Quem tem a tela "Alunos": orienta ou supervisiona estudantes. Ser só
// administrador ou só servidor não dá essa tela.
function temAlunosProprios(user) {
    const papeis = papeisDe(user);
    return Boolean(user) && (user.cargo === 'supervisor' || papeis.orientador === true || papeis.supervisor === true);
}

// Primeira tela depois do login, conforme os papéis.
function telaInicial(user) {
    if (!user || user.cargo === 'supervisor') return '/professor/dashboard';
    if (papeisDe(user).servidor) return '/professor/acompanhamento';
    if (temAlunosProprios(user)) return '/professor/dashboard';
    if (user.cargo === 'admin') return '/professor/administracao';
    return '/professor/dashboard';
}

module.exports = { PAPEIS, CHAVES_PAPEIS, papeisDoPerfil, veTodosOsEstagios, temAlunosProprios, telaInicial };
