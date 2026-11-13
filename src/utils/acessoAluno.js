// Quem pode ver ou mexer no estágio de um estudante dentro da área /professor.
// Ter uma conta interna não basta: é preciso vínculo com o estudante ou um
// papel de gestão (administrador ou setor de estágios).
const bancasModel = require('../models/bancas');
const { veTodosOsEstagios } = require('../config/papeis');

const mesmaPessoa = (id, user) => id != null && Number(id) === Number(user.id);

// Orientador ou supervisor do estudante.
function ehResponsavel(user, aluno) {
    return mesmaPessoa(aluno.orientador_id, user) || mesmaPessoa(aluno.supervisor_id, user);
}

// Cadastro na lista de espera ainda sem orientador: aparece para todos os
// professores, porque qualquer um deles pode aprovar o cadastro.
function aguardaOrientador(aluno) {
    return aluno.status === 'lista_espera' && !aluno.orientador_id;
}

// Consulta dos dados e das fichas: gestores, responsáveis, quem pode aprovar o
// cadastro e os avaliadores da banca do estudante.
async function podeVerAluno(user, aluno) {
    if (veTodosOsEstagios(user) || ehResponsavel(user, aluno)) return true;
    if (user.cargo === 'supervisor') return false;
    if (aguardaOrientador(aluno)) return true;
    const banca = await bancasModel.buscarPorAluno(aluno.usuario_id);
    return Boolean(banca) && banca.situacao !== 'cancelada'
        && [banca.orientador_id, banca.avaliador_1_id, banca.avaliador_2_id].some((id) => mesmaPessoa(id, user));
}

// Arquivar e desarquivar: gestores, responsáveis e quem pode aprovar o cadastro.
function podeArquivar(user, aluno) {
    if (user.cargo === 'supervisor') return false;
    return veTodosOsEstagios(user) || ehResponsavel(user, aluno) || aguardaOrientador(aluno);
}

// Carga horária total do estágio, em horas inteiras. Devolve null se inválida.
function lerCargaHoraria(valor) {
    const texto = String(valor ?? '').trim();
    if (!/^\d{1,4}$/.test(texto)) return null;
    const horas = Number(texto);
    return horas >= 1 ? horas : null;
}

module.exports = { ehResponsavel, podeVerAluno, podeArquivar, lerCargaHoraria };
