const router = require('express').Router();
const { requireRole, requireAdmin, requireNomeConfirmado, setFlash } = require('../middleware/auth');
const alunosModel = require('../models/alunos');
const atividadesModel = require('../models/atividades');
const usuariosModel = require('../models/usuarios');
const professoresModel = require('../models/professores');
const relatorioSemanalModel = require('../models/relatorioSemanal');
const { executar: enviarRelatorioSemanal } = require('../scripts/enviarRelatorioSemanalSupervisores');
const faasModel = require('../models/faas');
const faposModel = require('../models/fapos');
const fichasRascunhosModel = require('../models/fichasRascunhos');
const facsModel = require('../models/facs');
const faresModel = require('../models/fares');
const { gerarFapoPdf } = require('../services/fapoPdf');
const { ADMIN_PRINCIPAL_EMAIL } = require('../config/constants');
const avatares = require('../config/avatares');
const { DIAS_TRABALHO, validarHorarioTrabalho } = require('../utils/horarioTrabalho');
const { CURSOS, ehCurso } = require('../config/cursos');
const bancasModel = require('../models/bancas');
const acompanhamentoModel = require('../models/acompanhamento');
const { validarResponsaveis } = require('../utils/responsaveis');
const { PAPEIS, CHAVES_PAPEIS, papeisDoPerfil, veTodosOsEstagios, temAlunosProprios, telaInicial } = require('../config/papeis');

// Acompanhamento geral: administradores e servidores do setor de estágios.
// Curso do estudante: o orientador dele, o administrador e o setor de estágios.
function podeAlterarCurso(user, aluno) {
    return Number(aluno.orientador_id) === Number(user.id) || veTodosOsEstagios(user);
}

function requireVisaoGeral(req, res, next) {
    if (veTodosOsEstagios(req.session.user)) return next();
    setFlash(req, 'error', 'Apenas administradores e servidores do setor de estágios têm acesso a essa área.');
    return res.redirect('/professor/dashboard');
}

router.use(requireRole('professor'));

router.use(async (req, res, next) => {
    const user = req.session.user;
    const perfil = await professoresModel.buscarPorUsuarioId(user.id);
    if (!perfil) return res.redirect('/login');

    user.cargo = perfil.cargo;
    user.papeis = papeisDoPerfil(perfil);
    user.supervisorAprovado = perfil.aprovado;
    if (perfil.cargo !== 'supervisor') return next();
    if (!perfil.aprovado) return res.redirect('/supervisor/pendente');

    const caminhoPermitido = (req.method === 'GET' && [
        '/dashboard',
        '/completar-cadastro',
        '/usuarios',
    ].includes(req.path))
        || (req.method === 'POST' && req.path === '/completar-cadastro')
        || (req.method === 'POST' && /^\/(?:usuarios|supervisores)\/\d+\/aprovar$/.test(req.path))
        || (req.method === 'GET' && /^\/aluno\/\d+$/.test(req.path))
        || (req.method === 'POST' && /^\/aluno\/\d+\/atividade\/\d+\/(validar|invalidar)$/.test(req.path))
        || (/^\/aluno\/\d+\/fac(?:\/pdf)?$/.test(req.path) && ['GET', 'POST'].includes(req.method))
        // o supervisor não acessa FAA, FAPO, banca nem ata (FARE); só a ficha
        // de acompanhamento das atividades dos seus supervisionados
        || (req.method === 'GET' && /^\/aluno\/\d+\/ficha-acompanhamento$/.test(req.path));
    if (!caminhoPermitido) return res.redirect('/professor/dashboard');

    const alunoMatch = req.path.match(/^\/aluno\/(\d+)/);
    if (alunoMatch) {
        const aluno = await alunosModel.buscarPorUsuarioId(alunoMatch[1]);
        if (!aluno || Number(aluno.supervisor_id) !== Number(user.id)) {
            return res.status(403).send('Você não tem acesso a este estudante.');
        }
    }

    next();
});

// completar-cadastro fica ANTES do requireNomeConfirmado de propósito:
// é justamente a rota que resolve a pendência (nome incompleto vindo do GitHub).
router.get('/completar-cadastro', async (req, res) => {
    const usuario = await usuariosModel.buscarPorId(req.session.user.id);
    if (usuario && usuario.nome_confirmado) return res.redirect('/professor/dashboard');
    res.render('professor_completar_cadastro', {
        nomeAtual: usuario ? usuario.nome : '',
        avatares,
        selectedAvatar: usuario ? (usuario.avatar_emoji || '') : '',
    });
});

router.post('/completar-cadastro', async (req, res) => {
    const nome = (req.body.nome || '').trim();
    const avatarEmoji = (typeof req.body.avatarEmoji === 'string' ? req.body.avatarEmoji.trim() : '') || null;
    if (!nome || (avatarEmoji && !avatares.some((avatar) => avatar.emoji === avatarEmoji))) {
        setFlash(req, 'error', 'Informe seu nome completo. O avatar é opcional.');
        return res.redirect('/professor/completar-cadastro');
    }
    const usuario = await usuariosModel.confirmarNome(req.session.user.id, nome);
    await usuariosModel.atualizarAvatar(req.session.user.id, avatarEmoji);
    req.session.user.nome = usuario.nome;
    req.session.user.avatarEmoji = avatarEmoji;
    setFlash(req, 'success', 'Cadastro concluído com sucesso.');
    res.redirect('/professor/dashboard');
});

router.use(requireNomeConfirmado);
router.use(require('./fichas'));
router.use(require('./fac'));
router.use(require('./bancas'));
router.use(require('./estagios'));

const TAMANHO_PAGINA = 10;
const TAMANHO_PAGINA_USUARIOS = 10;
const STATUS_VALIDOS = ['lista_espera', 'em_andamento', 'aguardando_banca', 'encerrado', 'concluido'];
const CAMPOS_ORDENACAO = ['nome', 'supervisor', 'horas', 'status'];
const STATUS_FILTRO = ['lista_espera', 'em_andamento', 'aguardando_banca', 'encerrado'];
const SITUACOES_SUPERVISOR = ['andamento', 'concluido'];
const CAMPOS_ORDENACAO_USUARIOS = ['nome', 'email', 'tipo', 'situacao', 'criado_em'];

// Administração: contas, papéis e configurações. Fica separada das telas de
// alunos e fichas, porque quem administra nem sempre orienta ou supervisiona.
router.get('/administracao', requireAdmin, async (req, res) => {
    res.render('professor_administracao', { solicitacoesPendentes: await usuariosModel.contarSupervisoresPendentes() });
});

// Primeira tela depois do login: depende dos papéis da pessoa.
router.get('/inicio', (req, res) => res.redirect(telaInicial(req.session.user)));

router.get('/dashboard', async (req, res) => {
    // quem é só servidor não tem estudantes próprios: a lista dele é o acompanhamento
    // a administração tem página própria; a aba antiga só redireciona
    if (req.query.aba === 'administracao') return res.redirect('/professor/administracao');
    if (!temAlunosProprios(req.session.user) && telaInicial(req.session.user) !== '/professor/dashboard') {
        return res.redirect(telaInicial(req.session.user));
    }
    const isAdmin = req.session.user.cargo === 'admin';
    const isSupervisor = req.session.user.cargo === 'supervisor';
    const solicitacoesPendentes = await usuariosModel.contarSupervisoresPendentes();
    const aba = 'alunos';

    const busca = (req.query.q || '').trim();
    const arquivados = !isSupervisor && req.query.arquivados === '1';
    const campoOrdenacao = CAMPOS_ORDENACAO.includes(req.query.ordenar) ? req.query.ordenar : null;
    const direcao = req.query.dir === 'desc' ? 'desc' : 'asc';
    const ordenacao = { campo: campoOrdenacao, direcao };

    // o formulário envia "f=1" mesmo quando nenhum status está marcado,
    // pra diferenciar "sem filtro" (todos) do primeiro acesso (padrão)
    const filtroEnviado = req.query.f === '1'
        || req.query.status !== undefined
        || req.query.situacao !== undefined
        || req.query.q
        || arquivados
        || req.query.pagina !== undefined;

    // O supervisor não distingue as fases internas do estágio: enxerga apenas
    // "em andamento" (horas ainda não cumpridas) ou "concluído" (horas cumpridas).
    const situacoesSupervisor = [...new Set([].concat(req.query.situacao || []))]
        .filter((s) => SITUACOES_SUPERVISOR.includes(s));

    let status;
    if (isSupervisor) {
        const soAndamento = situacoesSupervisor.length === 1 && situacoesSupervisor[0] === 'andamento';
        const soConcluido = situacoesSupervisor.length === 1 && situacoesSupervisor[0] === 'concluido';
        if (soAndamento) status = ['lista_espera', 'em_andamento'];
        else if (soConcluido) status = ['concluido'];
        else status = [];
    } else {
        status = [...new Set([].concat(req.query.status || []))]
            .filter((s) => STATUS_VALIDOS.includes(s));
        if (!filtroEnviado && status.length === 0) {
            status = [...STATUS_FILTRO];
        }
    }

    let pagina = parseInt(req.query.pagina, 10);
    if (!Number.isFinite(pagina) || pagina < 1) pagina = 1;

    const filtros = { q: busca, status, situacao: situacoesSupervisor, arquivados };

    const consultar = () => alunosModel.listar({
        status,
        busca,
        arquivados,
        professorId: isAdmin || isSupervisor ? null : req.session.user.id,
        supervisorId: isSupervisor ? req.session.user.id : null,
        limite: TAMANHO_PAGINA,
        offset: (pagina - 1) * TAMANHO_PAGINA,
        ordenarPor: campoOrdenacao,
        direcao,
    });

    // bancas em que o professor participa aparecem em destaque no painel
    const minhasBancas = isSupervisor ? [] : await bancasModel.listarProximasDoProfessor(req.session.user.id);
    // destaque do supervisor: quem cumpriu as horas e ainda falta a FAC
    const facPendentes = isSupervisor
        ? await alunosModel.listarPendentesFac(req.session.user.id)
        : [];

    let resultado = await consultar();
    const totalPaginas = Math.max(1, Math.ceil(resultado.total / TAMANHO_PAGINA));

    if (pagina > totalPaginas) {
        pagina = totalPaginas;
        resultado = await consultar();
    }

    const filtroPersonalizado = isSupervisor
        ? Boolean(busca || situacoesSupervisor.length === 1)
        : Boolean(filtroEnviado);

    res.render('professor_dashboard', {
        aba,
        alunos: resultado.alunos,
        total: resultado.total,
        pagina,
        totalPaginas,
        tamanhoPagina: TAMANHO_PAGINA,
        filtros,
        filtroPersonalizado,
        ordenacao,
        solicitacoesPendentes,
        minhasBancas,
        facPendentes,
    });
});

function dataLocalIso(data = new Date()) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

function dataParaInput(valor) {
    if (!valor) return '';
    if (typeof valor === 'string') return valor.slice(0, 10);

    const data = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(data.getTime()) ? '' : dataLocalIso(data);
}

function dataIsoValida(valor) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

    const [ano, mes, dia] = valor.split('-').map(Number);
    const data = new Date(ano, mes - 1, dia);

    return data.getFullYear() === ano
        && data.getMonth() === mes - 1
        && data.getDate() === dia;
}

async function requireOrientadorFapo(req, res, next) {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Estagiário não encontrado.');
        return res.redirect('/professor/dashboard');
    }

    if (aluno.status !== 'concluido') {
        setFlash(req, 'error', 'A FAPO só pode ser gerada após a conclusão do estágio.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    if (Number(aluno.orientador_id) !== Number(req.session.user.id)) {
        setFlash(req, 'error', 'Apenas o professor orientador do estagiário pode gerar a FAPO.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    // com o estágio encerrado a FAPO vira só consulta (o PDF continua liberado)
    if (aluno.encerrado_em && !req.path.endsWith('/pdf')) {
        setFlash(req, 'error', 'O estágio foi encerrado, então a FAPO não pode mais ser alterada. Baixe o PDF ou reabra a ata.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    req.aluno = aluno;
    next();
}

router.get('/aluno/:id', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Estagiário não encontrado.');
        return res.redirect('/professor/dashboard');
    }

    const [atividades, professores, supervisores, supervisoresInternos, fapo, faa, fare, fac, fapoRascunho, facRascunho] = await Promise.all([
        atividadesModel.listarPorAluno(req.params.id),
        usuariosModel.listarProfessores(),
        usuariosModel.listarSupervisores(),
        usuariosModel.listarSupervisoresInternos(),
        faposModel.buscarPorAluno(req.params.id),
        faasModel.buscarPorAluno(req.params.id),
        faresModel.buscarPorAluno(req.params.id),
        facsModel.buscarPorAluno(req.params.id),
        fichasRascunhosModel.buscar(req.params.id, 'FAPO'),
        fichasRascunhosModel.buscar(req.params.id, 'FAC'),
    ]);

    const ehOrientador = Number(aluno.orientador_id) === Number(req.session.user.id);
    const encerrado = Boolean(aluno.encerrado_em);
    const podeGerarFapo = aluno.status === 'concluido' && ehOrientador && !encerrado;
    const podeValidarAtividades = !aluno.arquivado
        && !encerrado
        && Number(aluno.supervisor_id) === Number(req.session.user.id);

    res.render('professor_aluno', {
        aluno,
        diasTrabalho: DIAS_TRABALHO,
        atividades,
        professores,
        supervisores,
        supervisoresInternos,
        podeGerarFapo,
        fac,
        ehSupervisor: Number(aluno.supervisor_id) === Number(req.session.user.id),
        podeValidarAtividades,
        ehOrientador,
        gestor: veTodosOsEstagios(req.session.user),
        encerrado,
        fapo,
        fapoRascunho,
        faa,
        fare,
        facRascunho,
        cursos: CURSOS,
        aba: typeof req.query.aba === 'string' ? req.query.aba : '',
    });
});

// Dados cadastrais do estudante (nome, e-mail, matrícula e curso): administrador
// e setor de estágios. Preferências pessoais, como o avatar, ficam com o estudante.
router.post('/aluno/:id/dados', requireVisaoGeral, async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Estagiário não encontrado.');
        return res.redirect('/professor/dashboard');
    }
    const voltar = `/professor/aluno/${aluno.usuario_id}?aba=dados`;
    const erro = (mensagem) => { setFlash(req, 'error', mensagem); return res.redirect(voltar); };
    if (aluno.arquivado || aluno.encerrado_em) return erro('Não é possível alterar os dados de um estágio arquivado ou encerrado.');

    const nome = (req.body.nome || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const matricula = (req.body.matricula || '').trim() || null;
    const curso = typeof req.body.curso === 'string' ? req.body.curso : '';
    if (!nome || nome.length > 150 || !emailValido(email)) return erro('Informe o nome completo e um e-mail válido.');
    if ((matricula && matricula.length > 30) || !ehCurso(curso)) return erro('Confira a matrícula (até 30 caracteres) e selecione um curso.');
    const mesmoEmail = await usuariosModel.buscarPorEmail(email);
    if (mesmoEmail && Number(mesmoEmail.id) !== Number(aluno.usuario_id)) return erro('Já existe um cadastro com este e-mail.');
    const mesmaMatricula = matricula ? await alunosModel.buscarPorMatricula(matricula) : null;
    if (mesmaMatricula && Number(mesmaMatricula.usuario_id) !== Number(aluno.usuario_id)) return erro('Já existe um cadastro com esta matrícula.');

    try {
        await usuariosModel.atualizarDadosAdmin(aluno.usuario_id, nome, email);
        await alunosModel.atualizarMatricula(aluno.usuario_id, matricula);
        await alunosModel.atualizarCurso(aluno.usuario_id, curso);
    } catch (err) {
        console.error('[professor/aluno/dados] erro ao atualizar dados:', err.message);
        return erro(err.code === '23505' ? 'O e-mail ou a matrícula já está em uso.' : 'Não foi possível salvar os dados do estudante. Tente novamente.');
    }
    setFlash(req, 'success', 'Dados do estudante atualizados.');
    return res.redirect(voltar);
});

router.post('/aluno/:id/curso', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Estagiário não encontrado.');
        return res.redirect('/professor/dashboard');
    }
    const voltar = `/professor/aluno/${aluno.usuario_id}?aba=dados`;
    if (!podeAlterarCurso(req.session.user, aluno)) {
        setFlash(req, 'error', 'Apenas o orientador do estudante, um administrador ou o setor de estágios pode alterar o curso.');
        return res.redirect(voltar);
    }
    if (aluno.arquivado || aluno.encerrado_em) {
        setFlash(req, 'error', 'Não é possível alterar o curso de um estágio arquivado ou encerrado.');
        return res.redirect(voltar);
    }

    const curso = typeof req.body.curso === 'string' ? req.body.curso : '';
    if (!ehCurso(curso)) {
        setFlash(req, 'error', 'Selecione um dos cursos técnicos disponíveis.');
        return res.redirect(voltar);
    }

    try {
        await alunosModel.atualizarCurso(aluno.usuario_id, curso);
        setFlash(req, 'success', 'Curso do estudante atualizado.');
    } catch (err) {
        console.error('[professor/aluno/curso] erro ao atualizar curso:', err.message);
        setFlash(req, 'error', 'Não foi possível atualizar o curso do estudante. Tente novamente.');
    }
    return res.redirect(voltar);
});

router.get('/aluno/:id/fapo', requireOrientadorFapo, async (req, res) => {
    const fapoSalva = await faposModel.buscarPorAluno(req.params.id);
    const rascunhoSalvo = await fichasRascunhosModel.buscar(req.params.id, 'FAPO');

    res.render('professor_fapo', {
        aluno: req.aluno,
        fapoSalva,
        rascunhoSalvo,
        nota: rascunhoSalvo?.dados.nota ?? (fapoSalva ? Number(fapoSalva.nota) : ''),
        comentarios: rascunhoSalvo?.dados.comentarios ?? fapoSalva?.comentarios ?? '',
        dataAssinatura: rascunhoSalvo?.dados.data_assinatura ?? (fapoSalva ? dataParaInput(fapoSalva.data_assinatura) : dataLocalIso()),
        hoje: dataLocalIso(),
    });
});

router.post('/aluno/:id/fapo', requireOrientadorFapo, async (req, res) => {
    const acao = ['salvar', 'rascunho'].includes(req.body.acao) ? req.body.acao : 'salvar_pdf';
    if (acao === 'rascunho') {
        const campo = (valor, limite = 1500) => typeof valor === 'string' ? valor.slice(0, limite) : '';
        try {
            await fichasRascunhosModel.salvar(req.params.id, 'FAPO', {
                nota: campo(req.body.nota, 10),
                comentarios: campo(req.body.comentarios),
                data_assinatura: campo(req.body.data_assinatura, 10),
            });
            setFlash(req, 'success', 'Rascunho da FAPO salvo. Você poderá continuar o preenchimento mais tarde.');
        } catch (err) {
            console.error('[professor/fapo] erro ao salvar rascunho:', err.message);
            setFlash(req, 'error', 'Não foi possível salvar o rascunho da FAPO. Tente novamente.');
        }
        return res.redirect(`/professor/aluno/${req.params.id}/fapo`);
    }
    const notaBruta = req.body.nota;
    const nota = Number(notaBruta);
    const comentarios = (req.body.comentarios || '').trim();
    const dataAssinatura = req.body.data_assinatura || '';

    const dadosInvalidos = String(notaBruta ?? '').trim() === ''
        || !Number.isFinite(nota)
        || nota < 0
        || nota > 10
        || !dataIsoValida(dataAssinatura);

    if (dadosInvalidos) {
        setFlash(req, 'error', 'Preencha todos os campos obrigatórios com nota entre 0 e 10.');
        return res.redirect(`/professor/aluno/${req.params.id}/fapo`);
    }

    try {
        await faposModel.salvar({
            alunoId: req.params.id,
            nota,
            comentarios,
            dataAssinatura,
        });
    } catch (err) {
        console.error('[professor/fapo] erro ao salvar ficha:', err.message);
        setFlash(req, 'error', 'Não foi possível salvar a FAPO. Tente novamente.');
        return res.redirect(`/professor/aluno/${req.params.id}/fapo`);
    }

    if (acao === 'salvar') {
        setFlash(req, 'success', 'FAPO salva. O estagiário poderá gerar o PDF na área de fichas.');
        return res.redirect(`/professor/aluno/${req.params.id}/fapo`);
    }

    try {
        const pdfBytes = await gerarFapoPdf({
            aluno: req.aluno,
            empresa: req.aluno.empresa || '',
            nota,
            comentarios,
            dataAssinatura,
        });

        const nomeBase = String(req.aluno.nome)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'aluno';

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="FAPO-${nomeBase}.pdf"`);
        return res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('[professor/fapo] erro ao gerar PDF:', err.message);
        setFlash(req, 'error', 'A FAPO foi salva, mas não foi possível gerar o PDF. Tente novamente.');
        return res.redirect(`/professor/aluno/${req.params.id}/fapo`);
    }
});

router.get('/aluno/:id/fapo/pdf', requireOrientadorFapo, async (req, res) => {
    const fapo = await faposModel.buscarPorAluno(req.params.id);

    if (!fapo) {
        setFlash(req, 'error', 'Salve a FAPO antes de gerar o PDF.');
        return res.redirect(`/professor/aluno/${req.params.id}/fapo`);
    }

    try {
        const pdfBytes = await gerarFapoPdf({
            aluno: req.aluno,
            empresa: req.aluno.empresa || '',
            nota: Number(fapo.nota),
            comentarios: fapo.comentarios,
            dataAssinatura: dataParaInput(fapo.data_assinatura),
        });

        const nomeBase = String(req.aluno.nome)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'aluno';

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="FAPO-${nomeBase}.pdf"`);
        return res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('[professor/fapo/pdf] erro ao gerar PDF:', err.message);
        setFlash(req, 'error', 'Não foi possível gerar o PDF da FAPO. Tente novamente.');
        return res.redirect(`/professor/aluno/${req.params.id}/fapo`);
    }
});

router.post('/aluno/:id', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Estagiário não encontrado.');
        return res.redirect('/professor/dashboard');
    }
    // erros e sucesso voltam para a aba de edição da tela do estudante
    const voltar = `/professor/aluno/${req.params.id}?aba=estagio`;
    if (aluno.arquivado) {
        setFlash(req, 'error', 'Não é possível editar um estágio arquivado. Desarquive primeiro.');
        return res.redirect(voltar);
    }
    if (aluno.encerrado_em) {
        setFlash(req, 'error', 'O estágio foi encerrado. Reabra a ata da banca para alterar os dados.');
        return res.redirect(voltar);
    }
    // o orientador do estagiário, o administrador e o setor de estágios editam o estágio
    const ehOrientadorDoAluno = Number(aluno.orientador_id) === Number(req.session.user.id);
    if (!ehOrientadorDoAluno && !veTodosOsEstagios(req.session.user)) {
        setFlash(req, 'error', 'Apenas o orientador do estagiário, um administrador ou o setor de estágios pode editar o estágio.');
        return res.redirect(voltar);
    }
    // a primeira definição do estágio é feita no fluxo de aprovação
    if (aluno.status === 'lista_espera') {
        setFlash(req, 'error', 'Este cadastro ainda aguarda aprovação. Defina o estágio pelo fluxo de aprovação.');
        return res.redirect(`/professor/cadastro-aluno/${aluno.usuario_id}`);
    }

    const { empresa, supervisor_id, orientador_id, carga_horaria } = req.body;

    // o curso vem junto no formulário: orientador, administrador e setor de estágios podem trocá-lo
    const cursoInformado = typeof req.body.curso === 'string' ? req.body.curso : '';
    const mudouCurso = Boolean(cursoInformado) && cursoInformado !== aluno.curso;
    if (mudouCurso && !podeAlterarCurso(req.session.user, aluno)) {
        setFlash(req, 'error', 'Apenas o orientador do estudante, um administrador ou o setor de estágios pode alterar o curso.');
        return res.redirect(voltar);
    }
    if (mudouCurso && !ehCurso(cursoInformado)) {
        setFlash(req, 'error', 'Selecione um dos cursos técnicos disponíveis.');
        return res.redirect(voltar);
    }

    if (!empresa || !empresa.trim()) {
        setFlash(req, 'error', 'Informe a empresa onde o estagiário está realizando o estágio.');
        return res.redirect(voltar);
    }

    // o quadro de horários é opcional: sem dia marcado, fica vazio
    const diasMarcados = [].concat(req.body.dias_trabalho || []).filter(Boolean);
    const { horarioTrabalho, erro: erroHorario } = diasMarcados.length
        ? validarHorarioTrabalho(diasMarcados, req.body)
        : { horarioTrabalho: {} };
    if (erroHorario) {
        setFlash(req, 'error', erroHorario);
        return res.redirect(voltar);
    }

    // A edição não muda a situação: ela vem da aprovação, e "concluído" é
    // recalculado pelo modelo a partir das horas validadas e da carga horária.
    const status = 'em_andamento';

    // depois da aprovação o estágio sempre tem orientador
    if (!orientador_id) {
        setFlash(req, 'error', 'Selecione o professor orientador do estagiário.');
        return res.redirect(voltar);
    }

    const erroResponsaveis = await validarResponsaveis(supervisor_id, orientador_id);
    if (erroResponsaveis) {
        setFlash(req, 'error', erroResponsaveis);
        return res.redirect(voltar);
    }

    await alunosModel.atualizarEstagio(req.params.id, {
        status,
        empresa,
        supervisorId: supervisor_id || null,
        orientadorId: orientador_id || null,
        cargaHoraria: Number(carga_horaria),
        horarioTrabalho,
    });
    if (mudouCurso) await alunosModel.atualizarCurso(req.params.id, cursoInformado);

    setFlash(req, 'success', 'Estágio atualizado com sucesso.');
    res.redirect(voltar);
});

// ── Validação das horas ───────────────────────────────────────────────────

async function alterarValidacao(req, res, status) {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Estagiário não encontrado.');
        return res.redirect('/professor/dashboard');
    }

    if (aluno.arquivado) {
        setFlash(req, 'error', 'Não é possível validar horas de um estágio arquivado.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    if (aluno.encerrado_em) {
        setFlash(req, 'error', 'O estágio foi encerrado. Reabra a ata da banca para alterar validações.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    if (Number(aluno.supervisor_id) !== Number(req.session.user.id)) {
        setFlash(req, 'error', 'Somente o supervisor atribuído ao estagiário pode validar ou invalidar as atividades.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    const resultado = await atividadesModel.definirValidacao({
        atividadeId: req.params.atividadeId,
        alunoId: req.params.id,
        status,
        validadorId: req.session.user.id,
    });

    if (!resultado) {
        setFlash(req, 'error', 'Atividade não encontrada para este aluno.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    if (status === 'validada') {
        if (resultado.status === 'concluido' && aluno.status !== 'concluido') {
            setFlash(req, 'success', 'Horas validadas! O estagiário completou a carga horária e o estágio foi concluído.');
        } else {
            setFlash(req, 'success', 'Atividade validada com sucesso.');
        }
    } else if (resultado.status === 'em_andamento' && aluno.status === 'concluido') {
        setFlash(req, 'success', 'Atividade invalidada. O estagiário voltou para "Em andamento" e deverá registrar outra atividade.');
    } else {
        setFlash(req, 'success', 'Atividade invalidada. Essas horas não contam mais para a conclusão.');
    }

    res.redirect('/professor/aluno/' + req.params.id);
}

router.post('/aluno/:id/atividade/:atividadeId/validar', (req, res) => alterarValidacao(req, res, 'validada'));
router.post('/aluno/:id/atividade/:atividadeId/invalidar', (req, res) => alterarValidacao(req, res, 'invalidada'));

router.get('/cadastro-aluno/:id', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno || aluno.status !== 'lista_espera') {
        setFlash(req, 'error', 'Solicitação não encontrada ou já avaliada.');
        return res.redirect('/professor/dashboard');
    }

    const [professores, supervisores, supervisoresInternos] = await Promise.all([
        usuariosModel.listarProfessores(),
        usuariosModel.listarSupervisores(),
        usuariosModel.listarSupervisoresInternos(),
    ]);
    res.render('professor_cadastro_aluno', { aluno, professores, supervisores, supervisoresInternos, diasTrabalho: DIAS_TRABALHO });
});

router.post('/cadastro-aluno/:id', async (req, res) => {
    const { empresa, supervisor_id, orientador_id, carga_horaria } = req.body;
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno || aluno.status !== 'lista_espera') {
        setFlash(req, 'error', 'Solicitação não encontrada ou já avaliada.');
        return res.redirect('/professor/dashboard');
    }

    if (!empresa || !empresa.trim()) {
        setFlash(req, 'error', 'Informe a empresa onde o estagiário está realizando o estágio.');
        return res.redirect('/professor/cadastro-aluno/' + req.params.id);
    }

    if (!carga_horaria) {
        setFlash(req, 'error', 'Preencha a carga horária.');
        return res.redirect('/professor/cadastro-aluno/' + req.params.id);
    }

    // o quadro de horários é opcional: sem dia marcado, fica vazio
    const diasMarcados = [].concat(req.body.dias_trabalho || []).filter(Boolean);
    const { horarioTrabalho, erro: erroHorario } = diasMarcados.length
        ? validarHorarioTrabalho(diasMarcados, req.body)
        : { horarioTrabalho: {} };
    if (erroHorario) {
        setFlash(req, 'error', erroHorario);
        return res.redirect('/professor/cadastro-aluno/' + req.params.id);
    }

    // o orientador é obrigatório na aprovação: sem ele o estudante some do
    // painel dos professores comuns. O supervisor pode ser definido depois.
    if (!orientador_id) {
        setFlash(req, 'error', 'Selecione o professor orientador para aprovar o cadastro.');
        return res.redirect('/professor/cadastro-aluno/' + req.params.id);
    }

    const erroResponsaveis = await validarResponsaveis(supervisor_id, orientador_id);
    if (erroResponsaveis) {
        setFlash(req, 'error', erroResponsaveis);
        return res.redirect('/professor/cadastro-aluno/' + req.params.id);
    }

    await alunosModel.atualizarEstagio(req.params.id, {
        status: 'em_andamento',
        empresa,
        supervisorId: supervisor_id || null,
        orientadorId: orientador_id || null,
        cargaHoraria: Number(carga_horaria),
        horarioTrabalho,
    });

    setFlash(req, 'success', 'Cadastro aprovado! O estagiário já pode registrar atividades.');
    res.redirect('/professor/dashboard');
});

// ── Arquivados ────────────────────────────────────────────────────────────
// Arquivar/desarquivar: qualquer professor (comum ou admin).
// Excluir definitivamente: só admin.

// a lista de arquivados agora é a mesma tabela do dashboard, só com a flag
router.get('/arquivados', (req, res) => {
    res.redirect('/professor/dashboard?arquivados=1');
});

router.post('/aluno/:id/arquivar', async (req, res) => {
    const admin = req.session.user.cargo === 'admin';
    const arquivado = await alunosModel.arquivar(req.params.id, admin);
    if (!arquivado) {
        setFlash(req, 'error', 'Esse estagiário não pode ser arquivado.');
        return res.redirect(req.headers.referer || '/professor/dashboard');
    }
    setFlash(req, 'success', 'Estagiário arquivado com sucesso.');
    res.redirect(req.headers.referer || '/professor/dashboard');
});

router.post('/aluno/:id/desarquivar', async (req, res) => {
    await alunosModel.desarquivar(req.params.id);
    setFlash(req, 'success', 'Estagiário desarquivado com sucesso.');
    res.redirect('/professor/arquivados');
});

router.post('/aluno/:id/excluir', requireAdmin, async (req, res) => {
    const resultado = await usuariosModel.excluirSeSemVinculos(Number(req.params.id));
    if (!resultado.excluido) {
        setFlash(req, 'error', resultado.motivo === 'vinculado'
            ? 'Este estagiário possui registros ou vínculos associados e não pode ser excluído, mesmo arquivado. Remova os vínculos antes de tentar novamente.'
            : 'Estagiário não encontrado.');
        return res.redirect('/professor/arquivados');
    }

    setFlash(req, 'success', 'Estagiário excluído definitivamente.');
    res.redirect('/professor/arquivados');
});

// ── Lista de Professores (só admin) ──────────────────────────────────────
// req.session.user nunca aparece na própria lista (não faz sentido se
// confirmar/promover/excluir sozinho).

router.get('/usuarios', requireRole('professor'), async (req, res) => {
    res.locals.PAPEIS = PAPEIS;
    res.locals.papeisDoPerfil = papeisDoPerfil;
    const ehAdmin = req.session.user.cargo === 'admin';
    if (req.session.user.cargo === 'supervisor' && !req.session.user.supervisorAprovado) {
        return res.redirect('/supervisor/pendente');
    }

    const busca = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const solicitacoesPendentes = await usuariosModel.listarSupervisoresPendentes(ehAdmin ? '' : busca);
    if (!ehAdmin) {
        return res.render('professor_usuarios', {
            ehAdmin,
            solicitacoesPendentes,
            busca,
        });
    }

    const tipo = ['aluno', 'professor', 'servidor', 'supervisor'].includes(req.query.tipo) ? req.query.tipo : '';
    const situacao = ['ativo', 'desativado', 'pendente', 'aprovado'].includes(req.query.situacao)
        ? req.query.situacao
        : '';
    const ordenarPor = CAMPOS_ORDENACAO_USUARIOS.includes(req.query.ordenar) ? req.query.ordenar : 'nome';
    const direcao = req.query.dir === 'desc' ? 'desc' : 'asc';
    let pagina = Number.parseInt(req.query.pagina, 10);
    if (!Number.isSafeInteger(pagina) || pagina < 1) pagina = 1;
    const filtros = { busca, tipo, situacao };
    const consultar = () => usuariosModel.listarTodos({
        busca,
        tipo,
        situacao,
        ordenarPor,
        direcao,
        limite: TAMANHO_PAGINA_USUARIOS,
        offset: (pagina - 1) * TAMANHO_PAGINA_USUARIOS,
    });
    let resultado = await consultar();
    const totalPaginas = Math.max(1, Math.ceil(resultado.total / TAMANHO_PAGINA_USUARIOS));
    if (pagina > totalPaginas) {
        pagina = totalPaginas;
        resultado = await consultar();
    }
    res.render('professor_usuarios', {
        ehAdmin,
        usuarios: resultado.usuarios,
        total: resultado.total,
        solicitacoesPendentes,
        busca,
        filtros,
        ordenarPor,
        direcao,
        pagina,
        totalPaginas,
        tamanhoPagina: TAMANHO_PAGINA_USUARIOS,
        ADMIN_PRINCIPAL_EMAIL,
    });
});

// ── Cadastro e edição de usuários (administrador) ────────────────────────
function formularioUsuario(res, dados = {}) {
    res.render('professor_usuario_form', {
        cursos: CURSOS,
        PAPEIS,
        usuario: null,
        aluno: null,
        professor: null,
        // conta interna nova começa como hoje: pode orientar e supervisionar
        papeisAtuais: { admin: false, servidor: false, orientador: true, supervisor: true },
        proprio: false,
        principal: false,
        ...dados,
    });
}

router.get('/usuarios/novo', requireAdmin, (req, res) => formularioUsuario(res));

async function carregarUsuarioEditado(req, res, next) {
    const id = Number(req.params.id);
    const usuario = Number.isSafeInteger(id) && id > 0 ? await usuariosModel.buscarPorId(id) : null;
    if (!usuario) {
        setFlash(req, 'error', 'Usuário não encontrado.');
        return res.redirect('/professor/usuarios');
    }
    req.usuarioEditado = usuario;
    req.alunoEditado = usuario.tipo === 'aluno' ? await alunosModel.buscarPorUsuarioId(id) : null;
    req.professorEditado = usuario.tipo === 'professor' ? await professoresModel.buscarPorUsuarioId(id) : null;
    next();
}

router.get('/usuarios/:id/editar', requireAdmin, carregarUsuarioEditado, (req, res) => {
    const usuario = req.usuarioEditado;
    formularioUsuario(res, {
        usuario,
        aluno: req.alunoEditado,
        professor: req.professorEditado,
        papeisAtuais: papeisDoPerfil(req.professorEditado),
        proprio: Number(usuario.id) === Number(req.session.user.id),
        principal: usuario.email.toLowerCase() === ADMIN_PRINCIPAL_EMAIL.toLowerCase(),
    });
});

// Dashboard do administrador: situação de cada estudante e de cada curso.
const TAMANHO_PAGINA_ACOMPANHAMENTO = 15;
// ordenação da lista do acompanhamento; empate sempre desfeito pelo nome
const ORDENACOES_ACOMPANHAMENTO = {
    nome: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
    etapa: (a, b, etapas) => etapas.indexOf(a.etapa) - etapas.indexOf(b.etapa),
    horas: (a, b) => a.percentual - b.percentual,
    pendencias: (a, b) => a.pendencias.length - b.pendencias.length,
};

router.get('/acompanhamento', requireVisaoGeral, async (req, res) => {
    const { ETAPAS_ACOMPANHAMENTO, formatarHoras } = acompanhamentoModel;
    const ordenar = Object.hasOwn(ORDENACOES_ACOMPANHAMENTO, req.query.ordenar) ? req.query.ordenar : 'nome';
    const filtros = {
        q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '',
        curso: ehCurso(req.query.curso) ? req.query.curso : '',
        etapa: ETAPAS_ACOMPANHAMENTO.some((e) => e.chave === req.query.etapa) ? req.query.etapa : '',
        pendencias: req.query.pendencias === '1',
        ordenar,
        dir: req.query.dir === 'desc' ? 'desc' : 'asc',
    };
    const todos = await acompanhamentoModel.listarEstudantes();
    // os totais consideram todos; os filtros valem só para a lista de estudantes
    const termo = filtros.q.toLocaleLowerCase('pt-BR');
    const filtrados = todos.filter((a) => (!termo || a.nome.toLocaleLowerCase('pt-BR').includes(termo) || a.email.toLowerCase().includes(termo))
        && (!filtros.curso || a.curso === filtros.curso)
        && (!filtros.etapa || a.etapa === filtros.etapa)
        && (!filtros.pendencias || a.pendencias.length > 0));

    const chavesEtapas = ETAPAS_ACOMPANHAMENTO.map((e) => e.chave);
    const sinal = filtros.dir === 'desc' ? -1 : 1;
    filtrados.sort((a, b) => sinal * ORDENACOES_ACOMPANHAMENTO[ordenar](a, b, chavesEtapas)
        || a.nome.localeCompare(b.nome, 'pt-BR'));

    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / TAMANHO_PAGINA_ACOMPANHAMENTO));
    let pagina = Number.parseInt(req.query.pagina, 10);
    if (!Number.isInteger(pagina) || pagina < 1) pagina = 1;
    pagina = Math.min(pagina, totalPaginas);
    const inicio = (pagina - 1) * TAMANHO_PAGINA_ACOMPANHAMENTO;

    res.render('professor_acompanhamento', {
        resumo: acompanhamentoModel.resumir(todos),
        estudantes: filtrados.slice(inicio, inicio + TAMANHO_PAGINA_ACOMPANHAMENTO),
        paginacao: { pagina, totalPaginas, total: filtrados.length, inicio, tamanho: TAMANHO_PAGINA_ACOMPANHAMENTO },
        filtros,
        etapas: ETAPAS_ACOMPANHAMENTO,
        cursos: CURSOS,
        formatarHoras,
    });
});

router.get(['/professores', '/cadastros'], requireAdmin, (req, res) => {
    res.redirect('/professor/usuarios');
});

router.get('/relatorio-semanal', requireAdmin, async (req, res) => {
    const [configuracao, destinatarios] = await Promise.all([
        relatorioSemanalModel.buscarConfiguracao(),
        relatorioSemanalModel.listarDestinatarios(),
    ]);

    res.render('professor_relatorio_semanal', { configuracao, destinatarios });
});

router.post('/relatorio-semanal', requireAdmin, async (req, res) => {
    const diaSemana = typeof req.body.dia_semana === 'string' && /^[0-6]$/.test(req.body.dia_semana)
        ? Number(req.body.dia_semana)
        : NaN;
    const horario = typeof req.body.horario === 'string' ? req.body.horario : '';
    const habilitado = req.body.habilitado === 'on';

    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6
        || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(horario)
        || Number(horario.slice(3)) % 15 !== 0) {
        setFlash(req, 'error', 'Escolha um dia da semana e um horário válido, em intervalos de 15 minutos.');
        return res.redirect('/professor/relatorio-semanal');
    }

    await relatorioSemanalModel.salvarConfiguracao({ habilitado, diaSemana, horario });
    setFlash(req, 'success', habilitado
        ? 'Relatório semanal ativado e programação salva.'
        : 'Envio semanal desativado. A programação foi salva.');
    res.redirect('/professor/relatorio-semanal');
});

router.post('/relatorio-semanal/enviar-agora', requireAdmin, async (req, res) => {
    try {
        const resultado = await enviarRelatorioSemanal({ forcar: true });
        if (!resultado.enviado) {
            setFlash(req, 'success', 'Nenhum professor elegível para receber o relatório no momento.');
        } else {
            setFlash(req, 'success', `Resumo enviado em uma única mensagem para ${resultado.destinatarios} supervisor(es) em cópia oculta, com ${resultado.estudantes} estudante(s).`);
        }
    } catch (erro) {
        console.error('[professor/relatorio-semanal] erro no envio manual:', erro.message);
        const mensagem = erro.code === 'EAUTH' || erro.responseCode === 535
            ? 'O servidor de e-mail rejeitou as credenciais SMTP. Confira SMTP_USER e SMTP_PASS no secret ENV_FILE do GitHub.'
            : 'Não foi possível enviar o relatório agora. Confira a configuração de e-mail e tente novamente.';
        setFlash(req, 'error', mensagem);
    }
    res.redirect('/professor/relatorio-semanal');
});

const lerPapeisMarcados = (body) => new Set([].concat(body.papeis || []).filter((p) => CHAVES_PAPEIS.includes(p)));
const emailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 150;

// Confere as regras para os papéis de uma conta interna. Devolve a mensagem
// de erro, ou '' quando o conjunto marcado pode ser gravado.
async function validarPapeis(alvo, marcados) {
    if (marcados.size === 0) return 'Escolha ao menos um papel. Para tirar o acesso, desative a conta.';
    if (!alvo) return '';
    // um papel com estudantes ou bancas em aberto não pode ser retirado
    const atuais = papeisDoPerfil(alvo);
    const vinculos = await professoresModel.contarVinculos(alvo.usuario_id);
    if (atuais.orientador && !marcados.has('orientador') && (vinculos.orientandos || vinculos.bancas)) {
        return `${alvo.nome} ainda orienta ${vinculos.orientandos} estudante(s) e participa de ${vinculos.bancas} banca(s) em aberto. Troque os responsáveis antes de retirar o papel de orientador.`;
    }
    if (atuais.supervisor && !marcados.has('supervisor') && vinculos.supervisionados) {
        return `${alvo.nome} ainda supervisiona ${vinculos.supervisionados} estudante(s). Troque o supervisor deles antes de retirar o papel de supervisor.`;
    }
    return '';
}
const papeisComoObjeto = (marcados) => Object.fromEntries(CHAVES_PAPEIS.map((p) => [p, marcados.has(p)]));

router.post('/usuarios', requireAdmin, async (req, res) => {
    const voltar = '/professor/usuarios/novo';
    // aceita também os nomes antigos de tipo: 'professor' e 'servidor' são contas internas
    const tipoInformado = req.body.tipo;
    const conta = ['professor', 'servidor', 'interno'].includes(tipoInformado) ? 'interno' : tipoInformado;
    const nome = (req.body.nome || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const matricula = (req.body.matricula || '').trim() || null;
    const curso = typeof req.body.curso === 'string' ? req.body.curso : '';
    const empresa = String(req.body.empresa || '').trim();
    const funcao = String(req.body.funcao || '').trim();

    if (!nome || nome.length > 150 || !emailValido(email)
        || !['aluno', 'interno', 'supervisor'].includes(conta)
        || (conta === 'supervisor' && (!empresa || empresa.length > 200 || !funcao || funcao.length > 150))
        || (conta === 'aluno' && (matricula && matricula.length > 30 || !ehCurso(curso)))) {
        setFlash(req, 'error', 'Confira os dados obrigatórios e o tipo de conta selecionado.');
        return res.redirect(voltar);
    }

    let papeis = {};
    if (conta === 'interno') {
        const marcados = lerPapeisMarcados(req.body);
        if (marcados.size === 0 && tipoInformado === 'servidor') marcados.add('servidor');
        if (marcados.size === 0 && tipoInformado === 'professor') { marcados.add('orientador'); marcados.add('supervisor'); }
        const erroPapeis = await validarPapeis(null, marcados);
        if (erroPapeis) {
            setFlash(req, 'error', erroPapeis);
            return res.redirect(voltar);
        }
        papeis = papeisComoObjeto(marcados);
    }

    if (await usuariosModel.buscarPorEmail(email)) {
        setFlash(req, 'error', 'Já existe um cadastro com este e-mail.');
        return res.redirect(voltar);
    }
    if (conta === 'aluno' && matricula && await alunosModel.buscarPorMatricula(matricula)) {
        setFlash(req, 'error', 'Já existe um cadastro com esta matrícula.');
        return res.redirect(voltar);
    }

    try {
        await usuariosModel.criarContaAdministrada({ nome, email, conta, matricula, curso, empresa, funcao, papeis });
        setFlash(req, 'success', conta === 'supervisor'
            ? 'Usuário cadastrado. Aprove a solicitação para liberar o acesso do supervisor.'
            : 'Usuário cadastrado com sucesso.');
        return res.redirect('/professor/usuarios');
    } catch (err) {
        console.error('[professor/usuarios] erro ao cadastrar usuário:', err.message);
        setFlash(req, 'error', err.code === '23505'
            ? 'O e-mail ou a matrícula já está em uso.'
            : 'Não foi possível cadastrar o usuário. Verifique os dados e tente novamente.');
        return res.redirect(voltar);
    }
});

// Edição: nome e e-mail de qualquer conta, mais os dados do tipo dela
// (estudante: matrícula e curso; interna: papéis; supervisor externo: empresa e função).
router.post('/usuarios/:id', requireAdmin, carregarUsuarioEditado, async (req, res) => {
    const usuario = req.usuarioEditado;
    const aluno = req.alunoEditado;
    const professor = req.professorEditado;
    const voltar = `/professor/usuarios/${usuario.id}/editar`;
    const erro = (mensagem) => { setFlash(req, 'error', mensagem); return res.redirect(voltar); };

    const nome = (req.body.nome || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    if (!nome || nome.length > 150 || !emailValido(email)) return erro('Informe o nome completo e um e-mail válido.');
    const mesmoEmail = await usuariosModel.buscarPorEmail(email);
    if (mesmoEmail && Number(mesmoEmail.id) !== Number(usuario.id)) return erro('Já existe um cadastro com este e-mail.');

    const proprio = Number(usuario.id) === Number(req.session.user.id);
    const externo = professor && professor.cargo === 'supervisor';
    let matricula = null; let curso = ''; let marcados = null; let empresa = ''; let funcao = '';

    if (aluno) {
        matricula = (req.body.matricula || '').trim() || null;
        curso = typeof req.body.curso === 'string' ? req.body.curso : '';
        if ((matricula && matricula.length > 30) || !ehCurso(curso)) return erro('Confira a matrícula (até 30 caracteres) e selecione um curso.');
        const mesmaMatricula = matricula ? await alunosModel.buscarPorMatricula(matricula) : null;
        if (mesmaMatricula && Number(mesmaMatricula.usuario_id) !== Number(usuario.id)) return erro('Já existe um cadastro com esta matrícula.');
    } else if (externo) {
        empresa = String(req.body.empresa || '').trim();
        funcao = String(req.body.funcao || '').trim();
        if (!empresa || empresa.length > 200 || !funcao || funcao.length > 150) return erro('Informe a empresa e o cargo ou função do supervisor.');
    } else if (professor && !proprio) {
        // ninguém altera os próprios papéis; o administrador principal nunca perde o de administrador
        marcados = lerPapeisMarcados(req.body);
        if (usuario.email.toLowerCase() === ADMIN_PRINCIPAL_EMAIL.toLowerCase()) marcados.add('admin');
        const erroPapeis = await validarPapeis(professor, marcados);
        if (erroPapeis) return erro(erroPapeis);
    }

    try {
        await usuariosModel.atualizarDadosAdmin(usuario.id, nome, email);
        if (aluno) {
            await alunosModel.atualizarMatricula(usuario.id, matricula);
            await alunosModel.atualizarCurso(usuario.id, curso);
        }
        if (externo) await professoresModel.atualizarDadosExternos(usuario.id, empresa, funcao);
        if (marcados) await professoresModel.definirPapeis(usuario.id, papeisComoObjeto(marcados));
    } catch (err) {
        console.error('[professor/usuarios] erro ao editar usuário:', err.message);
        return erro(err.code === '23505' ? 'O e-mail ou a matrícula já está em uso.' : 'Não foi possível salvar as alterações. Tente novamente.');
    }
    setFlash(req, 'success', `Dados de ${nome} atualizados.`);
    res.redirect('/professor/usuarios');
});

async function aprovarSupervisorExterno(req, res) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || id === Number(req.session.user.id)) {
        setFlash(req, 'error', 'Você não pode aprovar a própria solicitação.');
        return res.redirect('/professor/usuarios');
    }
    const aprovado = await professoresModel.aprovarSupervisor(id);
    setFlash(req, aprovado ? 'success' : 'error', aprovado
        ? 'Supervisor externo aprovado.'
        : 'Solicitação não encontrada ou já aprovada.');
    res.redirect('/professor/usuarios');
}

function requireSupervisorAprovador(req, res, next) {
    if (!req.session.user || req.session.user.tipo !== 'professor') {
        return res.redirect('/login');
    }
    if (req.session.user.cargo === 'supervisor' && !req.session.user.supervisorAprovado) {
        return res.redirect('/supervisor/pendente');
    }
    next();
}

router.post('/usuarios/:id/aprovar', requireSupervisorAprovador, aprovarSupervisorExterno);
router.post('/supervisores/:id/aprovar', requireSupervisorAprovador, aprovarSupervisorExterno);

router.post('/usuarios/:id/ativo', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
        setFlash(req, 'error', 'Usuário inválido.');
        return res.redirect('/professor/usuarios');
    }
    if (id === Number(req.session.user.id)) {
        setFlash(req, 'error', 'Você não pode desativar sua própria conta.');
        return res.redirect('/professor/usuarios');
    }
    const alvo = await usuariosModel.buscarPorId(id);
    if (!alvo) {
        setFlash(req, 'error', 'Usuário não encontrado.');
        return res.redirect('/professor/usuarios');
    }
    if (alvo.email.toLowerCase() === ADMIN_PRINCIPAL_EMAIL.toLowerCase()) {
        setFlash(req, 'error', 'A conta do administrador principal não pode ser desativada.');
        return res.redirect('/professor/usuarios');
    }
    if (req.body.ativo !== 'true' && req.body.ativo !== 'false') {
        setFlash(req, 'error', 'Estado de ativação inválido.');
        return res.redirect('/professor/usuarios');
    }
    const ativo = req.body.ativo === 'true';
    await usuariosModel.definirAtivo(id, ativo);
    setFlash(req, 'success', ativo ? 'Usuário ativado.' : 'Usuário desativado. As sessões abertas serão encerradas.');
    res.redirect('/professor/usuarios');
});

router.post('/usuarios/:id/excluir', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
        setFlash(req, 'error', 'Usuário inválido.');
        return res.redirect('/professor/usuarios');
    }
    if (id === Number(req.session.user.id)) {
        setFlash(req, 'error', 'Você não pode excluir sua própria conta.');
        return res.redirect('/professor/usuarios');
    }
    const alvo = await usuariosModel.buscarPorId(id);
    if (!alvo) {
        setFlash(req, 'error', 'Usuário não encontrado.');
        return res.redirect('/professor/usuarios');
    }
    if (alvo.email.toLowerCase() === ADMIN_PRINCIPAL_EMAIL.toLowerCase()) {
        setFlash(req, 'error', 'A conta do administrador principal não pode ser excluída.');
        return res.redirect('/professor/usuarios');
    }

    const resultado = await usuariosModel.excluirSeSemVinculos(id);
    if (!resultado.excluido) {
        setFlash(req, 'error', resultado.motivo === 'vinculado'
            ? 'Este usuário possui dados ou vínculos associados e não pode ser excluído. Desative a conta para bloquear o acesso.'
            : 'Usuário não encontrado.');
        return res.redirect('/professor/usuarios');
    }
    setFlash(req, 'success', 'Usuário excluído com sucesso.');
    res.redirect('/professor/usuarios');
});

// Troca só os papéis de uma conta interna (a edição completa fica em /usuarios/:id).
router.post('/usuarios/:id/papeis', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const voltar = '/professor/usuarios';
    const alvo = Number.isSafeInteger(id) ? await professoresModel.buscarPorUsuarioId(id) : null;
    if (!alvo || alvo.cargo === 'supervisor') {
        setFlash(req, 'error', 'Os papéis só podem ser definidos para contas internas (professores e servidores).');
        return res.redirect(voltar);
    }
    if (id === Number(req.session.user.id)) {
        setFlash(req, 'error', 'Você não pode alterar os próprios papéis.');
        return res.redirect(voltar);
    }
    const marcados = lerPapeisMarcados(req.body);
    if (alvo.email.toLowerCase() === ADMIN_PRINCIPAL_EMAIL.toLowerCase()) marcados.add('admin');
    const erroPapeis = await validarPapeis(alvo, marcados);
    if (erroPapeis) {
        setFlash(req, 'error', erroPapeis);
        return res.redirect(voltar);
    }
    await professoresModel.definirPapeis(id, papeisComoObjeto(marcados));
    const nomes = PAPEIS.filter((p) => marcados.has(p.chave)).map((p) => p.rotulo).join(', ');
    setFlash(req, 'success', `Papéis de ${alvo.nome} atualizados: ${nomes}.`);
    res.redirect(voltar);
});

router.post('/professores/:id/cargo', requireAdmin, async (req, res) => {
    if (Number(req.params.id) === req.session.user.id) {
        return res.redirect('/professor/usuarios');
    }
    const cargo = req.body.cargo === 'admin' ? 'admin' : 'comum';
    if (!await professoresModel.definirCargo(req.params.id, cargo)) {
        setFlash(req, 'error', 'O cargo deste usuário não pode ser alterado por esta tela.');
        return res.redirect('/professor/usuarios');
    }
    setFlash(req, 'success', 'Cargo atualizado com sucesso.');
    res.redirect('/professor/usuarios');
});

module.exports = router;
