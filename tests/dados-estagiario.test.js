// Quem altera os dados do estagiário: o orientador (estágio e curso), o
// administrador e o setor de estágios (tudo, menos preferências pessoais).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const alunos = require('../src/models/alunos');
const atividades = require('../src/models/atividades');
const professores = require('../src/models/professores');
const usuarios = require('../src/models/usuarios');
const faas = require('../src/models/faas');
const fapos = require('../src/models/fapos');
const fares = require('../src/models/fares');
const facs = require('../src/models/facs');
const fichasRascunhos = require('../src/models/fichasRascunhos');
const bancas = require('../src/models/bancas');

const INFORMATICA = 'Curso Técnico em Informática Integrado ao Ensino Médio';
const AGRO = 'Curso Técnico de Agropecuária Integrado ao Ensino Médio';
const ORIENTADOR = 10; const OUTRO = 11; const ADMIN = 12; const SERVIDOR = 13;
const PERFIS = {
    [ORIENTADOR]: { cargo: 'comum', papel_servidor: false },
    [OUTRO]: { cargo: 'comum', papel_servidor: false },
    [ADMIN]: { cargo: 'admin', papel_servidor: false },
    [SERVIDOR]: { cargo: 'comum', papel_servidor: true },
};

let server, url, aluno, salvo;
const restaurar = [];
function trocar(modulo, nome, fn) {
    const original = modulo[nome];
    restaurar.push(() => { modulo[nome] = original; });
    modulo[nome] = fn;
}

before(async () => {
    trocar(professores, 'buscarPorUsuarioId', async (id) => (PERFIS[id] ? { ...PERFIS[id], aprovado: true } : null));
    trocar(usuarios, 'buscarAcessoPorId', async (id) => ({ ...PERFIS[id], ativo: true, tipo: 'professor', nome: 'Pessoa ' + id, email: `p${id}@ifc.edu.br` }));
    trocar(usuarios, 'buscarPorId', async (id) => ({ id, nome_confirmado: true }));
    trocar(usuarios, 'buscarPorEmail', async (email) => (email === 'ocupado@exemplo.com' ? { id: 99 } : null));
    trocar(usuarios, 'atualizarDadosAdmin', async (id, nome, email) => { salvo.nome = nome; salvo.email = email; });
    trocar(usuarios, 'listarProfessores', async () => [{ id: ORIENTADOR, nome: 'Pessoa 10' }]);
    trocar(usuarios, 'listarSupervisores', async () => []);
    trocar(usuarios, 'listarSupervisoresInternos', async () => []);
    trocar(alunos, 'buscarPorUsuarioId', async () => aluno);
    trocar(alunos, 'buscarPorMatricula', async () => null);
    trocar(alunos, 'atualizarMatricula', async (id, matricula) => { salvo.matricula = matricula; });
    trocar(alunos, 'atualizarCurso', async (id, curso) => { salvo.curso = curso; });
    trocar(alunos, 'atualizarEstagio', async (id, dados) => { salvo.estagio = dados; });
    trocar(atividades, 'listarPorAluno', async () => []);
    for (const modelo of [faas, fapos, fares, facs]) trocar(modelo, 'buscarPorAluno', async () => null);
    trocar(fichasRascunhos, 'buscar', async () => null);
    trocar(bancas, 'buscarPorAluno', async () => null);

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../src/views'));
    app.locals.icone = require('../src/utils/icones').icone;
    app.locals.dataBr = (d) => String(d);
    app.locals.dataIso = (d) => String(d);
    app.use(express.urlencoded({ extended: false }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: false }));
    app.use((req, res, next) => {
        req.session.user = { id: Number(req.get('x-usuario')), tipo: 'professor' };
        next();
    });
    app.use(require('../src/middleware/auth').attachUser);
    app.use('/professor', require('../src/routes/professor'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
    salvo = {};
    aluno = {
        usuario_id: 1, nome: 'Estudante Teste', email: 'estudante@exemplo.com', matricula: null, curso: null,
        status: 'em_andamento', arquivado: false, encerrado_em: null, orientador_id: ORIENTADOR, supervisor_id: null,
        empresa: 'Empresa', carga_horaria: 200, horas_realizadas: 0, horas_pendentes: 0, horario_trabalho: {},
    };
});
after(async () => {
    restaurar.forEach((desfazer) => desfazer());
    await new Promise((resolve) => server.close(resolve));
});

const enviar = (usuarioId, caminho, campos) => fetch(`${url}/professor/aluno/1${caminho}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'x-usuario': String(usuarioId), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos),
});
const pagina = async (usuarioId) => (await fetch(`${url}/professor/aluno/1`, { headers: { 'x-usuario': String(usuarioId) } })).text();
const DADOS = { nome: 'Nome Corrigido', email: 'novo@exemplo.com', matricula: '2026001', curso: INFORMATICA };
const ESTAGIO = { empresa: 'Nova Empresa', orientador_id: String(ORIENTADOR), supervisor_id: '', carga_horaria: '300' };

for (const [papel, id] of [['administrador', ADMIN], ['servidor do setor de estágios', SERVIDOR]]) {
    test(`${papel} altera nome, e-mail, matrícula e curso do estudante`, async () => {
        const resposta = await enviar(id, '/dados', DADOS);
        assert.equal(resposta.status, 302);
        assert.deepEqual(salvo, { nome: 'Nome Corrigido', email: 'novo@exemplo.com', matricula: '2026001', curso: INFORMATICA });
    });

    test(`${papel} edita o estágio de um estudante que não orienta`, async () => {
        await enviar(id, '', ESTAGIO);
        assert.equal(salvo.estagio.empresa, 'Nova Empresa');
        assert.equal(salvo.estagio.cargaHoraria, 300);
    });

    test(`${papel} vê as abas de dados do estudante e de edição do estágio`, async () => {
        const html = await pagina(id);
        assert.match(html, /id="panel-dados"/);
        assert.match(html, /action="\/professor\/aluno\/1\/dados"/);
        assert.match(html, /id="panel-estagio"/);
        assert.doesNotMatch(html, /name="avatarEmoji"/);
    });
}

test('orientador edita o estágio e o curso, mas não os dados cadastrais', async () => {
    await enviar(ORIENTADOR, '', { ...ESTAGIO, curso: AGRO });
    assert.equal(salvo.estagio.empresa, 'Nova Empresa');
    assert.equal(salvo.curso, AGRO);

    salvo = {};
    await enviar(ORIENTADOR, '/dados', DADOS);
    assert.deepEqual(salvo, {});

    const html = await pagina(ORIENTADOR);
    assert.doesNotMatch(html, /id="panel-dados"/);
    assert.match(html, /id="panel-estagio"/);
    assert.match(html, /name="curso"/);
});

test('professor que não orienta o estudante não altera nem vê nada', async () => {
    await enviar(OUTRO, '/dados', DADOS);
    await enviar(OUTRO, '', ESTAGIO);
    await enviar(OUTRO, '/curso', { curso: INFORMATICA });
    assert.deepEqual(salvo, {});
    // nem abre a tela do estudante
    const resposta = await fetch(`${url}/professor/aluno/1`, { redirect: 'manual', headers: { 'x-usuario': String(OUTRO) } });
    assert.equal(resposta.status, 302);
    assert.equal(resposta.headers.get('location'), '/professor/inicio');
});

test('dados inválidos ou e-mail já usado são recusados', async () => {
    await enviar(SERVIDOR, '/dados', { ...DADOS, curso: 'Curso inventado' });
    await enviar(SERVIDOR, '/dados', { ...DADOS, email: 'ocupado@exemplo.com' });
    await enviar(SERVIDOR, '/dados', { ...DADOS, nome: '' });
    assert.deepEqual(salvo, {});
});

test('estágio arquivado ou encerrado fica bloqueado também para o setor de estágios', async () => {
    aluno.arquivado = true;
    await enviar(ADMIN, '/dados', DADOS);
    await enviar(ADMIN, '', ESTAGIO);
    aluno.arquivado = false;
    aluno.encerrado_em = new Date();
    await enviar(SERVIDOR, '/dados', DADOS);
    await enviar(SERVIDOR, '/curso', { curso: INFORMATICA });
    assert.deepEqual(salvo, {});
});

test('estudante na lista de espera: o setor de estágios já corrige os dados cadastrais', async () => {
    aluno.status = 'lista_espera';
    const html = await pagina(SERVIDOR);
    assert.match(html, /id="panel-dados"/);
    assert.doesNotMatch(html, /id="panel-estagio"/);
    await enviar(SERVIDOR, '/dados', DADOS);
    assert.equal(salvo.curso, INFORMATICA);
});
