// Provedores de login. Em produção o acesso é só com Google; o GitHub continua
// disponível em desenvolvimento, para testes.
function loginGithubHabilitado() {
    return process.env.APP_ENV !== 'production';
}

module.exports = { loginGithubHabilitado };
