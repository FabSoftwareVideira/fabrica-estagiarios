// Inclusão de estágios pelo setor de estágios (servidores e administradores).
// Fluxo em etapas: estagiário → responsáveis → estágio → horários → revisão.
// O formulário pode ser salvo como rascunho em qualquer etapa e retomado depois,
// inclusive por outra pessoa do setor. Montado dentro de /professor.
const router = require('express').Router();
const { setFlash } = require('../middleware/auth');
const alunosModel = require('../models/alunos');
const usuariosModel = require('../models/usuarios');
const rascunhosModel = require('../models/estagiosRascunhos');
const { CURSOS, ehCurso } = require('../config/cursos');
const { DIAS_TRABALHO, validarHorarioTrabalho } = require('../utils/horarioTrabalho');
const { validarResponsaveis } = require('../utils/responsaveis');
const { veTodosOsEstagios } = require('../config/papeis');

const ETAPAS = ['Estagiário', 'Responsáveis', 'Estágio', 'Horários', 'Revisão'];

router.use('/estagios', (req, res, next) => {
    if (veTodosOsEstagios(req.session.user)) return next();
    setFlash(req, 'error', 'A inclusão de estágios é feita pelo setor de estágios.');
    return res.redirect('/professor/inicio');
});

const texto = (valor, max) => (typeof valor === 'string' ? valor.trim().slice(0, max) : '');
const idValido = (valor) => (/^[1-9]\d{0,9}$/.test(String(valor || '')) ? String(valor) : '');

// Lê o formulário num objeto simples: é o que vai para o rascunho e o que
// volta para a tela quando há erro.
function lerDados(body) {
    const marcados = [].concat(body.dias_trabalho || []).map(String).filter((d) => /^[1-6]$/.test(d));
    const horarios = {};
    for (const dia of DIAS_TRABALHO) {
        const inicio = texto(body[`horario_inicio_${dia.id}`], 5);
        const fim = texto(body[`horario_fim_${dia.id}`], 5);
        if (marcados.includes(String(dia.id)) || inicio || fim) horarios[dia.id] = { inicio, fim, marcado: marcados.includes(String(dia.id)) };
    }
    const passo = Number.parseInt(body.passo, 10);
    return {
        modo: body.modo === 'existente' ? 'existente' : 'novo',
        aluno_id: idValido(body.aluno_id),
        nome: texto(body.nome, 150),
        email: texto(body.email, 150).toLowerCase(),
        matricula: texto(body.matricula, 30),
        curso: ehCurso(body.curso) ? body.curso : '',
        orientador_id: idValido(body.orientador_id),
        supervisor_id: idValido(body.supervisor_id),
        empresa: texto(body.empresa, 200),
        carga_horaria: /^\d{1,4}$/.test(String(body.carga_horaria || '')) ? String(body.carga_horaria) : '',
        horarios,
        passo: Number.isInteger(passo) && passo >= 0 && passo < ETAPAS.length ? passo : 0,
    };
}

// Converte de volta para os nomes de campo usados por validarHorarioTrabalho.
function corpoDosHorarios(dados) {
    const corpo = {};
    const dias = [];
    for (const [dia, h] of Object.entries(dados.horarios || {})) {
        if (h.marcado) dias.push(dia);
        corpo[`horario_inicio_${dia}`] = h.inicio;
        corpo[`horario_fim_${dia}`] = h.fim;
    }
    return { dias, corpo };
}

async function renderizarFormulario(res, { dados = {}, rascunhoId = '', erros = [], status = 200 } = {}) {
    const [emEspera, professores, supervisores, supervisoresInternos] = await Promise.all([
        rascunhosModel.listarEstudantesEmEspera(),
        usuariosModel.listarProfessores(),
        usuariosModel.listarSupervisores(),
        usuariosModel.listarSupervisoresInternos(),
    ]);
    const valores = { modo: emEspera.length ? 'existente' : 'novo', horarios: {}, passo: 0, ...dados };
    // horários no formato do formulário compartilhado
    const horarioTrabalho = {};
    for (const [dia, h] of Object.entries(valores.horarios || {})) {
        if (h.marcado && h.inicio && h.fim) horarioTrabalho[dia] = { inicio: h.inicio, fim: h.fim };
    }
    res.status(status).render('professor_estagio_form', {
        valores, rascunhoId, erros, emEspera, professores, supervisores, supervisoresInternos,
        cursos: CURSOS, diasTrabalho: DIAS_TRABALHO, horarioTrabalho, etapas: ETAPAS,
        // depois de um erro, volta para a primeira etapa com problema (ou a salva no rascunho)
        etapaInicial: erros.length ? (dados.etapaComErro || 0) : (valores.passo || 0),
    });
}

router.get('/estagios', async (req, res) => {
    const rascunhos = await rascunhosModel.listar();
    res.render('professor_estagios', { rascunhos, etapas: ETAPAS });
});

router.get('/estagios/novo', async (req, res) => {
    const id = idValido(req.query.rascunho);
    if (!id) return renderizarFormulario(res);
    const rascunho = await rascunhosModel.buscar(id);
    if (!rascunho) {
        setFlash(req, 'error', 'Rascunho não encontrado. Ele pode ter sido concluído ou excluído por outra pessoa do setor.');
        return res.redirect('/professor/estagios');
    }
    return renderizarFormulario(res, { dados: rascunho.dados, rascunhoId: String(rascunho.id) });
});

// Salvar rascunho: aceita o formulário incompleto, em qualquer etapa.
router.post('/estagios/rascunho', async (req, res) => {
    const dados = lerDados(req.body);
    const id = idValido(req.body.rascunho_id);
    let salvo = await rascunhosModel.salvar(id || null, req.session.user.id, dados);
    if (!salvo) salvo = await rascunhosModel.salvar(null, req.session.user.id, dados); // excluído enquanto era editado
    setFlash(req, 'success', 'Rascunho salvo. Você ou outra pessoa do setor pode continuar de onde parou.');
    res.redirect('/professor/estagios');
});

router.post('/estagios/rascunhos/:id/excluir', async (req, res) => {
    const id = idValido(req.params.id);
    const excluido = id ? await rascunhosModel.excluir(id) : false;
    setFlash(req, excluido ? 'success' : 'error', excluido ? 'Rascunho excluído.' : 'Rascunho não encontrado.');
    res.redirect('/professor/estagios');
});

// Concluir a inclusão: valida tudo, cria a conta do estudante se for novo e
// coloca o estágio em andamento, como na aprovação de cadastro.
router.post('/estagios', async (req, res) => {
    const dados = lerDados(req.body);
    const rascunhoId = idValido(req.body.rascunho_id);
    const erros = [];
    const errar = (etapa, mensagem) => {
        erros.push(mensagem);
        if (dados.etapaComErro === undefined) dados.etapaComErro = etapa;
    };

    let alunoId = null;
    if (dados.modo === 'existente') {
        const aluno = dados.aluno_id ? await alunosModel.buscarPorUsuarioId(dados.aluno_id) : null;
        if (!aluno) errar(0, 'Selecione o estudante na lista de espera.');
        else if (aluno.status !== 'lista_espera' || aluno.arquivado) errar(0, `${aluno.nome} já tem o estágio definido ou foi arquivado. Escolha outro estudante.`);
        else alunoId = aluno.usuario_id;
    } else {
        if (!dados.nome) errar(0, 'Informe o nome completo do estudante.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) errar(0, 'Informe um e-mail válido para o estudante.');
        else if (await usuariosModel.buscarPorEmail(dados.email)) errar(0, 'Já existe uma conta com este e-mail. Se o estudante já se cadastrou, escolha-o em "Estudante já cadastrado".');
        if (!dados.curso) errar(0, 'Selecione o curso do estudante.');
        if (dados.matricula && await alunosModel.buscarPorMatricula(dados.matricula)) errar(0, 'Já existe um estudante com esta matrícula.');
    }

    if (!dados.orientador_id) errar(1, 'Selecione o professor orientador.');
    const erroResponsaveis = await validarResponsaveis(dados.supervisor_id || null, dados.orientador_id || null);
    if (erroResponsaveis) errar(1, erroResponsaveis);

    if (!dados.empresa) errar(2, 'Informe a empresa ou entidade concedente.');
    if (!(Number(dados.carga_horaria) >= 1)) errar(2, 'Informe a carga horária total, em horas.');

    const { dias, corpo } = corpoDosHorarios(dados);
    // na inclusão o quadro de horários é opcional; os dias marcados seguem as regras de sempre
    const { horarioTrabalho, erro: erroHorario } = dias.length ? validarHorarioTrabalho(dias, corpo) : { horarioTrabalho: {} };
    if (erroHorario) errar(3, erroHorario);

    if (erros.length) return renderizarFormulario(res, { dados, rascunhoId, erros, status: 422 });

    try {
        if (!alunoId) {
            alunoId = await usuariosModel.criarContaAdministrada({
                nome: dados.nome, email: dados.email, conta: 'aluno', matricula: dados.matricula || null, curso: dados.curso,
            });
        }
        await alunosModel.atualizarEstagio(alunoId, {
            status: 'em_andamento',
            empresa: dados.empresa,
            supervisorId: dados.supervisor_id || null,
            orientadorId: dados.orientador_id,
            cargaHoraria: Number(dados.carga_horaria),
            horarioTrabalho,
        });
    } catch (err) {
        console.error('[professor/estagios] erro ao incluir estágio:', err.message);
        erros.push(err.code === '23505' ? 'O e-mail ou a matrícula já está em uso.' : 'Não foi possível incluir o estágio. Tente novamente.');
        return renderizarFormulario(res, { dados, rascunhoId, erros, status: 422 });
    }

    if (rascunhoId) await rascunhosModel.excluir(rascunhoId);
    setFlash(req, 'success', dados.modo === 'novo'
        ? 'Estágio incluído e conta do estudante criada. O estudante entra com a conta Google deste e-mail e já pode registrar atividades.'
        : 'Estágio incluído. O estudante já pode registrar atividades.');
    res.redirect(`/professor/aluno/${alunoId}`);
});

module.exports = router;
