// Conta: entrada com Google, escolha de perfil no primeiro acesso, meu
// perfil, saída e o login de desenvolvimento.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente, PESSOAS, CURSO } = require('./helpers/ambiente');
const { ADMIN_PRINCIPAL_EMAIL } = require('../src/config/constants');

let amb;
const { ana, bruno, fabio, orientadora, externoPendente } = PESSOAS;

// Respostas simuladas do Google; o resto das requisições segue para o servidor de teste.
let google;
const fetchReal = globalThis.fetch;
globalThis.fetch = async (endereco, opcoes) => {
    const url = String(endereco);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
        if (google.falhaRede) throw new Error('rede indisponível');
        return Response.json(google.token, { status: google.token.access_token ? 200 : 400 });
    }
    if (url.startsWith('https://openidconnect.googleapis.com/')) {
        assert.equal(opcoes.headers.Authorization, `Bearer ${google.token.access_token}`);
        return Response.json(google.perfil);
    }
    return fetchReal(endereco, opcoes);
};

before(async () => {
    amb = await criarAmbiente({
        antesDasRotas() {
            process.env.GOOGLE_CLIENT_ID = 'cliente-teste';
            process.env.GOOGLE_CLIENT_SECRET = 'segredo-teste';
            process.env.GOOGLE_CALLBACK_URL = 'https://estagios.example.test/auth/google/callback';
        },
    });
});
beforeEach(async () => {
    await amb.semear();
    google = { token: { access_token: 'tok-1' }, perfil: { sub: 'g-1', email: 'nova@estudante.test', email_verified: true, name: 'Nova Pessoa' } };
});
after(async () => { await amb.fechar(); globalThis.fetch = fetchReal; });

// Faz o caminho completo: /auth/google guarda o state na sessão e o callback o confere.
async function entrarComGoogle(sessao = 'g') {
    const inicio = await amb.pedir('/auth/google', { sessao });
    const destino = new URL(inicio.local);
    assert.equal(destino.host, 'accounts.google.com');
    assert.equal(destino.searchParams.get('client_id'), 'cliente-teste');
    const state = destino.searchParams.get('state');
    assert.equal(amb.sessoes.get(sessao).googleOauthState, state);
    return amb.pedir(`/auth/google/callback?code=codigo&state=${state}`, { sessao });
}
const usuarioDaSessao = (sessao = 'g') => amb.sessoes.get(sessao)?.user;

// ── Google ───────────────────────────────────────────────────────────────
test('callback sem o state guardado é recusado', async () => {
    await amb.pedir('/auth/google', { sessao: 'g' });
    const r = await amb.pedir('/auth/google/callback?code=codigo&state=outro', { sessao: 'g' });
    assert.equal(r.local, '/login');
    assert.match(amb.flash('g').message, /Falha na autenticação/);
    assert.equal(amb.sessoes.get('g').googleOauthState, undefined);
    assert.equal(usuarioDaSessao(), undefined);
});

test('primeiro acesso externo cria a conta e pergunta o perfil', async () => {
    const r = await entrarComGoogle();
    assert.equal(r.local, '/acesso/perfil');
    const [u] = await amb.sql("SELECT tipo, google_id, nome FROM usuarios WHERE email = 'nova@estudante.test'");
    assert.deepEqual(u, { tipo: 'aluno', google_id: 'g-1', nome: 'Nova Pessoa' });
    assert.equal(usuarioDaSessao().tipo, 'aluno');
});

test('e-mail institucional entra como professor; o administrador principal já entra como administrador', async () => {
    google.perfil = { sub: 'g-2', email: 'Nova.Docente@IFC.edu.br', email_verified: true };
    assert.equal((await entrarComGoogle()).local, '/professor/inicio');
    const [p] = await amb.sql("SELECT u.nome, p.cargo FROM usuarios u JOIN professores p ON p.usuario_id = u.id WHERE u.email = 'nova.docente@ifc.edu.br'");
    assert.deepEqual(p, { nome: 'nova.docente', cargo: 'comum' });

    google.perfil = { sub: 'g-3', email: ADMIN_PRINCIPAL_EMAIL, email_verified: true, name: 'Principal' };
    await entrarComGoogle('g2');
    assert.equal(usuarioDaSessao('g2').cargo, 'admin');
});

test('conta já cadastrada pelo e-mail é vinculada ao Google no primeiro login', async () => {
    google.perfil = { sub: 'g-ana', email: 'ANA@estudante.test', email_verified: true, picture: 'https://foto.example/ana.png' };
    assert.equal((await entrarComGoogle()).local, '/aluno/dashboard');
    assert.equal(usuarioDaSessao().id, ana);
    assert.equal((await amb.sql('SELECT google_id FROM usuarios WHERE id = $1', [ana]))[0].google_id, 'g-ana');
    // nas próximas vezes, entra pelo identificador do Google
    google.perfil = { ...google.perfil, email: 'outro-email@estudante.test' };
    await entrarComGoogle('g2');
    assert.equal(usuarioDaSessao('g2').id, ana);
});

test('e-mail igual não assume conta já ligada a outra conta Google', async () => {
    await amb.sql("UPDATE usuarios SET google_id = 'g-original' WHERE id = $1", [ana]);
    google.perfil = { sub: 'g-intruso', email: 'ana@estudante.test', email_verified: true };
    assert.equal((await entrarComGoogle()).local, '/login');
    assert.match(amb.flash('g').message, /já está vinculado a outra conta Google/);
    assert.equal(usuarioDaSessao(), undefined);
});

test('conta desativada não entra, nem pelo e-mail nem pelo Google', async () => {
    await amb.sql('UPDATE usuarios SET ativo = false WHERE id = $1', [ana]);
    google.perfil = { sub: 'g-ana', email: 'ana@estudante.test', email_verified: true };
    await entrarComGoogle();
    assert.match(amb.flash('g').message, /desativada/);

    await amb.sql("UPDATE usuarios SET google_id = 'g-ana' WHERE id = $1", [ana]);
    await entrarComGoogle('g2');
    assert.match(amb.flash('g2').message, /desativada/);
    assert.equal(usuarioDaSessao('g2'), undefined);
});

test('falhas do Google: sem token, e-mail não verificado ou erro de rede', async () => {
    google.token = { error: 'invalid_grant' };
    await entrarComGoogle();
    assert.match(amb.flash('g').message, /Não foi possível concluir o login/);

    google.token = { access_token: 'tok-2' };
    google.perfil = { sub: 'g-9', email: 'x@estudante.test', email_verified: false };
    await entrarComGoogle('g2');
    assert.match(amb.flash('g2').message, /e-mail verificado/);

    google.falhaRede = true;
    await entrarComGoogle('g3');
    assert.match(amb.flash('g3').message, /Erro ao autenticar/);
});

test('supervisor externo ainda não aprovado vai para a tela de espera', async () => {
    await amb.sql("UPDATE usuarios SET google_id = 'g-pedro' WHERE id = $1", [externoPendente]);
    google.perfil = { sub: 'g-pedro', email: 'pedro@empresa.test', email_verified: true };
    assert.equal((await entrarComGoogle()).local, '/supervisor/pendente');
});

// ── Escolha de perfil no primeiro acesso ────────────────────────────────
test('primeiro acesso: continuar como estudante ou pedir acesso de supervisor', async () => {
    assert.equal((await amb.pedir('/acesso/perfil', { como: fabio })).status, 200);
    assert.equal((await amb.pedir('/acesso/perfil', { como: fabio, corpo: { tipo: 'aluno' } })).local, '/aluno/dashboard');

    await amb.pedir('/acesso/perfil', { como: fabio, corpo: { tipo: 'outro' } });
    assert.match(amb.flash(fabio).message, /Escolha se deseja continuar/);
    await amb.pedir('/acesso/perfil', { como: fabio, corpo: { tipo: 'supervisor', empresa: 'Agro Vale', funcao: '' } });
    assert.match(amb.flash(fabio).message, /Informe a empresa e sua função/);

    const r = await amb.pedir('/acesso/perfil', { como: fabio, corpo: { tipo: 'supervisor', empresa: ' Agro Vale ', funcao: 'Gerente' } });
    assert.equal(r.local, '/supervisor/pendente');
    const [p] = await amb.sql('SELECT u.tipo, p.cargo, p.aprovado, p.empresa_externa FROM usuarios u JOIN professores p ON p.usuario_id = u.id WHERE u.id = $1', [fabio]);
    assert.deepEqual(p, { tipo: 'professor', cargo: 'supervisor', aprovado: false, empresa_externa: 'Agro Vale' });
});

test('a escolha de perfil não serve para quem já tem cadastro', async () => {
    assert.equal((await amb.pedir('/acesso/perfil', { como: ana })).local, '/aluno/dashboard');
    assert.equal((await amb.pedir('/acesso/perfil', { como: orientadora })).local, '/professor/dashboard');
    assert.equal((await amb.pedir('/acesso/perfil')).local, '/login');
});

// ── Meu perfil ───────────────────────────────────────────────────────────
test('meu perfil do estudante: nome, avatar, matrícula, curso e e-mails', async () => {
    assert.equal((await amb.pedir('/perfil')).local, '/login');
    assert.equal((await amb.pedir('/perfil', { como: ana })).status, 200);

    const casos = [
        [{ nome: '', curso: CURSO }, /nome completo/],
        [{ nome: 'Ana', curso: CURSO, avatarEmoji: '💣' }, /avatar da lista/],
        [{ nome: 'Ana', curso: 'Medicina' }, /cursos técnicos/],
        [{ nome: 'Ana', curso: CURSO, matricula: '2024002' }, /matrícula já está cadastrada/],
        [{ nome: 'Ana', curso: CURSO, matricula: 'A2024' }, /apenas números/],
    ];
    for (const [corpo, mensagem] of casos) {
        await amb.pedir('/perfil', { como: ana, corpo });
        assert.match(amb.flash(ana).message, mensagem);
    }

    const outroCurso = 'Curso Técnico de Agropecuária Integrado ao Ensino Médio';
    await amb.pedir('/perfil', { como: ana, corpo: { nome: 'Ana A. Andrade', curso: outroCurso, matricula: '2024999', avatarEmoji: '🦊', receber_lembretes_atividades: 'on' } });
    assert.equal(amb.flash(ana).message, 'Perfil atualizado com sucesso.');
    const [u] = await amb.sql(`SELECT u.nome, u.avatar_emoji, u.receber_email_bancas, u.receber_lembretes_atividades, a.matricula, a.curso
        FROM usuarios u JOIN alunos a ON a.usuario_id = u.id WHERE u.id = $1`, [ana]);
    assert.deepEqual(u, { nome: 'Ana A. Andrade', avatar_emoji: '🦊', receber_email_bancas: false, receber_lembretes_atividades: true, matricula: '2024999', curso: outroCurso });
});

test('meu perfil do professor: relatório semanal e avisos de banca', async () => {
    await amb.pedir('/perfil', { como: orientadora, corpo: { nome: 'Olga Orientadora', receber_email_bancas: 'on' } });
    assert.equal(amb.flash(orientadora).type, 'success');
    const [p] = await amb.sql(`SELECT u.receber_email_bancas, u.receber_lembretes_atividades, p.receber_relatorio_semanal
        FROM usuarios u JOIN professores p ON p.usuario_id = u.id WHERE u.id = $1`, [orientadora]);
    assert.deepEqual(p, { receber_email_bancas: true, receber_lembretes_atividades: true, receber_relatorio_semanal: false });
});

// ── Entrada, saída e redirecionamentos ───────────────────────────────────
test('login e página inicial levam cada pessoa para a sua área', async () => {
    assert.equal((await amb.pedir('/login')).local, '/');
    assert.equal((await amb.pedir('/', {})).status, 200);
    assert.equal((await amb.pedir('/login', { como: ana })).local, '/aluno/dashboard');
    assert.equal((await amb.pedir('/login', { como: orientadora })).local, '/professor/inicio');
    assert.equal((await amb.pedir('/login', { como: externoPendente })).local, '/supervisor/pendente');
    assert.equal((await amb.pedir('/', { como: ana })).local, '/aluno/dashboard');
    assert.equal((await amb.pedir('/', { como: orientadora })).local, '/professor/dashboard');
    assert.equal((await amb.pedir('/rota-que-nao-existe')).status, 404);
});

test('sair encerra a sessão', async () => {
    await amb.pedir('/perfil', { como: bruno });
    assert.equal((await amb.pedir('/logout', { como: bruno })).local, '/login');
    assert.equal(amb.sessoes.has(`u${bruno}`), false);
});

// ── Login de desenvolvimento ────────────────────────────────────────────
test('login de desenvolvimento cria as contas de teste com os papéis certos', async (t) => {
    const anterior = process.env.APP_ENV;
    process.env.APP_ENV = 'development';
    t.after(() => { if (anterior === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = anterior; });

    assert.equal((await amb.pedir('/auth/dev/servidor', { sessao: 'd1' })).local, '/professor/inicio');
    const [servidor] = await amb.sql("SELECT p.papel_servidor, p.papel_orientador FROM usuarios u JOIN professores p ON p.usuario_id = u.id WHERE u.email = 'servidor.dev@ifc.edu.br'");
    assert.deepEqual(servidor, { papel_servidor: true, papel_orientador: false });

    assert.equal((await amb.pedir('/auth/dev/professor-admin', { sessao: 'd2' })).local, '/professor/inicio');
    assert.equal(amb.sessoes.get('d2').user.cargo, 'admin');
    // a mesma conta, de novo, reaproveita o cadastro e corrige o cargo
    await amb.sql("UPDATE professores SET cargo = 'comum' WHERE usuario_id = (SELECT id FROM usuarios WHERE email = 'professor.admin.dev@ifc.edu.br')");
    await amb.pedir('/auth/dev/professor-admin', { sessao: 'd3' });
    assert.equal(amb.sessoes.get('d3').user.cargo, 'admin');

    assert.equal((await amb.pedir('/auth/dev/aluno', { sessao: 'd4' })).local, '/aluno/dashboard');
    await amb.sql("UPDATE usuarios SET ativo = false WHERE email = 'aluno.dev@exemplo.com'");
    assert.equal((await amb.pedir('/auth/dev/aluno', { sessao: 'd5' })).status, 403);

    process.env.APP_ENV = 'production';
    assert.equal((await amb.pedir('/auth/dev/aluno', { sessao: 'd6' })).status, 404);
});
