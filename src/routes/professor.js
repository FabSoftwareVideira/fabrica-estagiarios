const router = require('express').Router();
const { requireRole, requireAdmin, requireNomeConfirmado, setFlash } = require('../middleware/auth');
const alunosModel = require('../models/alunos');
const atividadesModel = require('../models/atividades');
const usuariosModel = require('../models/usuarios');
const professoresModel = require('../models/professores');
const relatorioSemanalModel = require('../models/relatorioSemanal');
const { executar: enviarRelatorioSemanal } = require('../scripts/enviarRelatorioSemanalOrientadores');
const faasModel = require('../models/faas');
const faposModel = require('../models/fapos');
const { gerarFapoPdf } = require('../services/fapoPdf');
const { ADMIN_PRINCIPAL_EMAIL } = require('../config/constants');
const avatares = require('../config/avatares');

router.use(requireRole('professor'));

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
    const avatarEmoji = typeof req.body.avatarEmoji === 'string' ? req.body.avatarEmoji.trim() : '';
    if (!nome || !avatares.some((avatar) => avatar.emoji === avatarEmoji)) {
        setFlash(req, 'error', 'Informe seu nome completo e escolha um avatar.');
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

const TAMANHO_PAGINA = 10;
const STATUS_VALIDOS = ['lista_espera', 'em_andamento', 'concluido'];
const CAMPOS_ORDENACAO = ['nome', 'supervisor', 'horas', 'status'];

router.get('/dashboard', async (req, res) => {
    const isAdmin = req.session.user.cargo === 'admin';
    const aba = isAdmin
        ? (req.query.aba === 'administracao' ? 'administracao' : 'alunos')
        : (req.query.aba === 'supervisionados' ? 'supervisionados' : 'orientandos');

    if (aba === 'administracao') {
        return res.render('professor_dashboard', {
            aba,
            alunos: [],
            total: 0,
            pagina: 1,
            totalPaginas: 1,
            tamanhoPagina: TAMANHO_PAGINA,
            filtros: { q: '', status: [], arquivados: false },
            filtroPersonalizado: false,
            ordenacao: { campo: null, direcao: 'asc' },
        });
    }

    const busca = (req.query.q || '').trim();
    const arquivados = req.query.arquivados === '1';
    const campoOrdenacao = CAMPOS_ORDENACAO.includes(req.query.ordenar) ? req.query.ordenar : null;
    const direcao = req.query.dir === 'desc' ? 'desc' : 'asc';
    const ordenacao = { campo: campoOrdenacao, direcao };

    // o formulário envia "f=1" mesmo quando nenhum status está marcado,
    // pra diferenciar "sem filtro" (todos) do primeiro acesso (padrão)
    const filtroEnviado = req.query.f === '1'
        || req.query.status !== undefined
        || req.query.q
        || arquivados
        || req.query.pagina !== undefined;

    let status = [...new Set([].concat(req.query.status || []))]
        .filter((s) => STATUS_VALIDOS.includes(s));

    if (!filtroEnviado && status.length === 0) {
        status = ['lista_espera', 'em_andamento', 'concluido'];
    }

    let pagina = parseInt(req.query.pagina, 10);
    if (!Number.isFinite(pagina) || pagina < 1) pagina = 1;

    const filtros = { q: busca, status, arquivados };

    const consultar = () => alunosModel.listar({
        status,
        busca,
        arquivados,
        orientadorId: !isAdmin && aba === 'orientandos' ? req.session.user.id : null,
        supervisorId: !isAdmin && aba === 'supervisionados' ? req.session.user.id : null,
        limite: TAMANHO_PAGINA,
        offset: (pagina - 1) * TAMANHO_PAGINA,
        ordenarPor: campoOrdenacao,
        direcao,
    });

    let resultado = await consultar();
    const totalPaginas = Math.max(1, Math.ceil(resultado.total / TAMANHO_PAGINA));

    if (pagina > totalPaginas) {
        pagina = totalPaginas;
        resultado = await consultar();
    }

    res.render('professor_dashboard', {
        aba,
        alunos: resultado.alunos,
        total: resultado.total,
        pagina,
        totalPaginas,
        tamanhoPagina: TAMANHO_PAGINA,
        filtros,
        filtroPersonalizado: Boolean(filtroEnviado),
        ordenacao,
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
        setFlash(req, 'error', 'Aluno não encontrado.');
        return res.redirect('/professor/dashboard');
    }

    if (aluno.status !== 'concluido') {
        setFlash(req, 'error', 'A FAPO só pode ser gerada após a conclusão do estágio.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    if (Number(aluno.orientador_id) !== Number(req.session.user.id)) {
        setFlash(req, 'error', 'Apenas o professor orientador do aluno pode gerar a FAPO.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    req.aluno = aluno;
    next();
}

router.get('/aluno/:id', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Aluno não encontrado.');
        return res.redirect('/professor/dashboard');
    }

    const [atividades, professores] = await Promise.all([
        atividadesModel.listarPorAluno(req.params.id),
        usuariosModel.listarProfessores(),
    ]);

    const podeGerarFapo = aluno.status === 'concluido'
        && Number(aluno.orientador_id) === Number(req.session.user.id);

    res.render('professor_aluno', { aluno, atividades, professores, podeGerarFapo });
});

router.get('/aluno/:id/fapo', requireOrientadorFapo, async (req, res) => {
    const fapoSalva = await faposModel.buscarPorAluno(req.params.id);

    res.render('professor_fapo', {
        aluno: req.aluno,
        fapoSalva,
        nota: fapoSalva ? Number(fapoSalva.nota) : '',
        comentarios: fapoSalva ? fapoSalva.comentarios : '',
        dataAssinatura: fapoSalva ? dataParaInput(fapoSalva.data_assinatura) : dataLocalIso(),
        hoje: dataLocalIso(),
    });
});

router.post('/aluno/:id/fapo', requireOrientadorFapo, async (req, res) => {
    const acao = req.body.acao === 'salvar' ? 'salvar' : 'salvar_pdf';
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
        setFlash(req, 'success', 'FAPO salva. O aluno poderá gerar o PDF na área de fichas.');
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
        setFlash(req, 'error', 'Aluno não encontrado.');
        return res.redirect('/professor/dashboard');
    }
    if (aluno.arquivado) {
        setFlash(req, 'error', 'Não é possível editar um estágio arquivado. Desarquive primeiro.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    const { empresa, supervisor_id, orientador_id, carga_horaria } = req.body;

    if (!empresa || !empresa.trim()) {
        setFlash(req, 'error', 'Informe a empresa onde o aluno está realizando o estágio.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    // "concluido" só é atribuído automaticamente pelo modelo quando as horas
    // validadas atingem a carga horária; aqui o professor só alterna entre
    // lista de espera e em andamento.
    const status = req.body.status === 'lista_espera' ? 'lista_espera' : 'em_andamento';

    if (supervisor_id && orientador_id && supervisor_id === orientador_id) {
        setFlash(req, 'error', 'Supervisor e orientador não podem ser o mesmo professor.');
        return res.redirect('/professor/aluno/' + req.params.id);
    }

    await alunosModel.atualizarEstagio(req.params.id, {
        status,
        empresa,
        supervisorId: supervisor_id || null,
        orientadorId: orientador_id || null,
        cargaHoraria: Number(carga_horaria),
    });

    setFlash(req, 'success', 'Estágio atualizado com sucesso.');
    res.redirect('/professor/aluno/' + req.params.id);
});

// ── Validação das horas ───────────────────────────────────────────────────

async function alterarValidacao(req, res, status) {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Aluno não encontrado.');
        return res.redirect('/professor/dashboard');
    }

    if (aluno.arquivado) {
        setFlash(req, 'error', 'Não é possível validar horas de um estágio arquivado.');
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
            setFlash(req, 'success', 'Horas validadas! O aluno completou a carga horária e o estágio foi concluído.');
        } else {
            setFlash(req, 'success', 'Atividade validada com sucesso.');
        }
    } else if (resultado.status === 'em_andamento' && aluno.status === 'concluido') {
        setFlash(req, 'success', 'Atividade invalidada. O aluno voltou para "Em andamento" e deverá registrar outra atividade.');
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

    const professores = await usuariosModel.listarProfessores();
    res.render('professor_cadastro_aluno', { aluno, professores });
});

router.post('/cadastro-aluno/:id', async (req, res) => {
    const { empresa, supervisor_id, orientador_id, carga_horaria } = req.body;

    if (!empresa || !empresa.trim()) {
        setFlash(req, 'error', 'Informe a empresa onde o aluno está realizando o estágio.');
        return res.redirect('/professor/cadastro-aluno/' + req.params.id);
    }

    if (!carga_horaria) {
        setFlash(req, 'error', 'Preencha a carga horária.');
        return res.redirect('/professor/cadastro-aluno/' + req.params.id);
    }

    // supervisor e orientador podem ficar em branco aqui e ser
    // definidos/trocados depois na tela de editar aluno
    if (supervisor_id && orientador_id && supervisor_id === orientador_id) {
        setFlash(req, 'error', 'Supervisor e orientador não podem ser o mesmo professor.');
        return res.redirect('/professor/cadastro-aluno/' + req.params.id);
    }

    await alunosModel.atualizarEstagio(req.params.id, {
        status: 'em_andamento',
        empresa,
        supervisorId: supervisor_id || null,
        orientadorId: orientador_id || null,
        cargaHoraria: Number(carga_horaria),
    });

    setFlash(req, 'success', 'Cadastro aprovado! O aluno já pode registrar atividades.');
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
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno || aluno.arquivado || aluno.status === 'concluido') {
        setFlash(req, 'error', 'Esse aluno não pode ser arquivado.');
        return res.redirect(req.headers.referer || '/professor/dashboard');
    }
    await alunosModel.arquivar(req.params.id);
    setFlash(req, 'success', 'Aluno arquivado com sucesso.');
    res.redirect(req.headers.referer || '/professor/dashboard');
});

router.post('/aluno/:id/desarquivar', async (req, res) => {
    await alunosModel.desarquivar(req.params.id);
    setFlash(req, 'success', 'Aluno desarquivado com sucesso.');
    res.redirect('/professor/arquivados');
});

router.post('/aluno/:id/excluir', requireAdmin, async (req, res) => {
    await alunosModel.excluir(req.params.id);
    setFlash(req, 'success', 'Aluno excluído definitivamente.');
    res.redirect('/professor/arquivados');
});

// ── Lista de Professores (só admin) ──────────────────────────────────────
// req.session.user nunca aparece na própria lista (não faz sentido se
// confirmar/promover/excluir sozinho).

router.get('/professores', requireAdmin, async (req, res) => {
    const lista = await professoresModel.listarExceto(req.session.user.id);
    res.render('professor_lista', { professores: lista, ADMIN_PRINCIPAL_EMAIL });
});

router.get('/cadastros', requireAdmin, (req, res) => {
    res.render('professor_cadastros');
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
            setFlash(req, 'success', `Resumo enviado em uma única mensagem para ${resultado.destinatarios} professor(es) em cópia oculta, com ${resultado.estudantes} estudante(s).`);
        }
    } catch (erro) {
        console.error('[professor/relatorio-semanal] erro no envio manual:', erro.message);
        setFlash(req, 'error', 'Não foi possível enviar o relatório agora. Confira a configuração de e-mail e tente novamente.');
    }
    res.redirect('/professor/relatorio-semanal');
});

router.post('/cadastros', requireAdmin, async (req, res) => {
    const tipo = req.body.tipo === 'professor' ? 'professor' : 'aluno';
    const nome = (req.body.nome || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const matriculaInformada = (req.body.matricula || '').trim();
    const matricula = matriculaInformada || null;

    if (!nome || !email) {
        setFlash(req, 'error', 'Preencha todos os campos obrigatórios.');
        return res.redirect('/professor/cadastros');
    }

    const usuarioExistente = await usuariosModel.buscarPorEmail(email);
    if (usuarioExistente) {
        setFlash(req, 'error', 'Já existe um cadastro com este e-mail.');
        return res.redirect('/professor/cadastros');
    }

    if (tipo === 'aluno' && matricula) {
        const matriculaExistente = await alunosModel.buscarPorMatricula(matricula);
        if (matriculaExistente) {
            setFlash(req, 'error', 'Já existe um cadastro com esta matrícula.');
            return res.redirect('/professor/cadastros');
        }
    }

    try {
        const usuario = await usuariosModel.criar({
            nome,
            email,
            tipo,
            nomeConfirmado: true,
        });

        if (tipo === 'aluno') {
            await alunosModel.criar({ usuarioId: usuario.id, matricula });
        } else {
            await professoresModel.criar({ usuarioId: usuario.id });
        }

        setFlash(req, 'success', `${tipo === 'aluno' ? 'Aluno' : 'Professor'} cadastrado com sucesso.`);
    } catch (err) {
        console.error('[professor/cadastros] erro:', err.message);
        setFlash(req, 'error', 'Não foi possível concluir o cadastro. Verifique os dados e tente novamente.');
    }
    res.redirect('/professor/cadastros');
});

router.post('/professores/:id/cargo', requireAdmin, async (req, res) => {
    if (Number(req.params.id) === req.session.user.id) {
        return res.redirect('/professor/professores');
    }
    const cargo = req.body.cargo === 'admin' ? 'admin' : 'comum';
    await professoresModel.definirCargo(req.params.id, cargo);
    setFlash(req, 'success', 'Cargo atualizado com sucesso.');
    res.redirect('/professor/professores');
});

router.post('/professores/:id/excluir', requireAdmin, async (req, res) => {
    if (Number(req.params.id) === req.session.user.id) {
        setFlash(req, 'error', 'Você não pode excluir a própria conta.');
        return res.redirect('/professor/professores');
    }

    const alvo = await professoresModel.buscarPorUsuarioId(req.params.id);
    if (alvo && alvo.email.toLowerCase() === ADMIN_PRINCIPAL_EMAIL.toLowerCase()) {
        setFlash(req, 'error', 'Esta conta é o administrador principal e não pode ser excluída.');
        return res.redirect('/professor/professores');
    }

    await professoresModel.excluir(req.params.id);
    setFlash(req, 'success', 'Professor excluído com sucesso.');
    res.redirect('/professor/professores');
});

module.exports = router;
