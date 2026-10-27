const router = require('express').Router();
const { requireRole, requireEmAndamento, requireAlunoCompleto, setFlash } = require('../middleware/auth');
const alunosModel = require('../models/alunos');
const atividadesModel = require('../models/atividades');
const usuariosModel = require('../models/usuarios');
const faasModel = require('../models/faas');
const faposModel = require('../models/fapos');
const { gerarFaaPdf, formatarDataBr } = require('../services/faaPdf');
const { gerarFichaAcompanhamentoPdf } = require('../services/fichaAcompanhamentoPdf');
const { gerarFapoPdf } = require('../services/fapoPdf');

router.use(requireRole('aluno'));

// completar-cadastro fica ANTES do requireAlunoCompleto de propósito:
// é justamente a rota que resolve a pendência dele.
router.get('/completar-cadastro', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.session.user.id);
    if (aluno) return res.redirect('/aluno/dashboard'); // já completou, não deixa preencher de novo
    res.render('aluno_completar_cadastro', { nomeAtual: req.session.user.nome });
});

router.post('/completar-cadastro', async (req, res) => {
    const matricula = (req.body.matricula || '').trim();
    const nome = (req.body.nome || '').trim();
    if (!matricula || !nome) {
        setFlash(req, 'error', 'Informe seu nome completo e sua matrícula.');
        return res.redirect('/aluno/completar-cadastro');
    }
    try {
        // o GitHub nem sempre devolve o nome completo (às vezes só o primeiro
        // nome/login), então aproveitamos essa telinha pra confirmar/corrigir
        await usuariosModel.confirmarNome(req.session.user.id, nome);
        req.session.user.nome = nome;

        await alunosModel.criar({ usuarioId: req.session.user.id, matricula });
        setFlash(req, 'success', 'Cadastro concluído! Você entrará na lista de espera até a aprovação de um professor.');
        res.redirect('/aluno/dashboard');
    } catch (err) {
        if (err.code === '23505') {
            setFlash(req, 'error', 'Essa matrícula já está cadastrada.');
        } else {
            console.error('[aluno/completar-cadastro] erro:', err.message);
            setFlash(req, 'error', 'Não foi possível concluir o cadastro. Tente novamente.');
        }
        res.redirect('/aluno/completar-cadastro');
    }
});

router.use(requireAlunoCompleto);

function dataLocalIso(data = new Date()) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

function dataIsoValida(valor) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

    const [ano, mes, dia] = valor.split('-').map(Number);
    const data = new Date(ano, mes - 1, dia);

    return data.getFullYear() === ano
        && data.getMonth() === mes - 1
        && data.getDate() === dia;
}

function dataParaInput(valor) {
    if (!valor) return '';
    if (typeof valor === 'string') return valor.slice(0, 10);

    const data = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(data.getTime()) ? '' : dataLocalIso(data);
}

function enviarPdf(res, alunoNome, pdfBytes) {
    const nomeBase = String(alunoNome)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'aluno';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="FAA-${nomeBase}.pdf"`);
    return res.send(Buffer.from(pdfBytes));
}

async function requireEstagioConcluido(req, res, next) {
    const aluno = await alunosModel.buscarPorUsuarioId(req.session.user.id);

    if (!aluno || aluno.status !== 'concluido') {
        setFlash(req, 'error', 'A FAA só pode ser gerada após a conclusão do estágio.');
        return res.redirect('/aluno/dashboard');
    }

    req.aluno = aluno;
    next();
}

router.get('/dashboard', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.session.user.id);
    const ultimaAtividade = await atividadesModel.ultimaPorAluno(req.session.user.id);
    const fapoSalva = await faposModel.buscarPorAluno(req.session.user.id);

    const horasRealizadas = Number(aluno.horas_realizadas);
    const horasPendentes = Number(aluno.horas_pendentes);
    const cargaHoraria = aluno.carga_horaria;
    const percentual = cargaHoraria > 0 ? Math.min(100, Math.round((horasRealizadas / cargaHoraria) * 100)) : 0;

    res.render('aluno_dashboard', {
        aluno,
        ultimaAtividade,
        fapoSalva,
        horasRealizadas,
        horasPendentes,
        cargaHoraria,
        horasRestantes: Math.max(0, cargaHoraria - horasRealizadas),
        percentual,
    });
});

router.get('/faa', requireEstagioConcluido, async (req, res) => {
    const faaSalva = await faasModel.buscarPorAluno(req.session.user.id);
    const atividades = await atividadesModel.listarPorAluno(req.session.user.id);
    const validadas = atividades
        .filter((a) => a.status_validacao === 'validada')
        .sort((a, b) => new Date(a.data) - new Date(b.data));

    const datas = validadas
        .map((a) => new Date(a.data))
        .filter((data) => !Number.isNaN(data.getTime()));

    const periodoSugerido = datas.length > 0
        ? `${formatarDataBr(datas[0])} a ${formatarDataBr(datas[datas.length - 1])}`
        : '';

    const atividadesSugeridas = validadas
        .map((a) => `${formatarDataBr(a.data)} - ${a.descricao} (${Number(a.horas)}h)`)
        .join('\n');

    res.render('aluno_faa', {
        aluno: req.aluno,
        faaSalva,
        empresa: req.aluno.empresa || (faaSalva ? faaSalva.empresa : ''),
        periodo: faaSalva ? faaSalva.periodo : periodoSugerido,
        atividadesTexto: faaSalva ? faaSalva.atividades : atividadesSugeridas,
        comentarios: faaSalva ? faaSalva.comentarios : '',
        dataAssinatura: faaSalva ? dataParaInput(faaSalva.data_assinatura) : dataLocalIso(),
        notasSalvas: faaSalva ? faaSalva.notas : [],
        respostasSalvas: faaSalva ? faaSalva.respostas : [],
    });
});

router.post('/faa', requireEstagioConcluido, async (req, res) => {
    const acao = req.body.acao === 'salvar' ? 'salvar' : 'salvar_pdf';
    // a empresa é a cadastrada no estágio pelo professor, nunca digitada pelo aluno
    const empresa = (req.aluno.empresa || '').trim();

    if (!empresa) {
        setFlash(req, 'error', 'A empresa/concedente não foi cadastrada pelo professor do estágio.');
        return res.redirect('/aluno/faa');
    }

    const periodo = (req.body.periodo || '').trim();
    const atividades = (req.body.atividades || '').trim();
    const comentarios = (req.body.comentarios || '').trim();
    const notasBrutas = Array.from({ length: 10 }, (_, i) => req.body[`nota_${i + 1}`]);
    const notas = notasBrutas.map((nota) => Number(nota));
    const respostas = Array.from({ length: 7 }, (_, i) => req.body[`q_${i + 1}`]);
    const respostasValidas = ['sim', 'nao', 'mais_menos'];

    const dataAssinatura = req.body.data_assinatura || '';

    const dadosInvalidos = !periodo
        || !atividades
        || !dataIsoValida(dataAssinatura)
        || notasBrutas.some((nota) => String(nota ?? '').trim() === '')
        || notas.some((nota) => !Number.isFinite(nota) || nota < 0 || nota > 10)
        || respostas.some((resposta) => !respostasValidas.includes(resposta));

    if (dadosInvalidos) {
        setFlash(req, 'error', 'Preencha todos os campos obrigatórios com notas entre 0 e 10.');
        return res.redirect('/aluno/faa');
    }

    try {
        await faasModel.salvar({
            alunoId: req.session.user.id,
            empresa,
            periodo,
            notas,
            atividades,
            respostas,
            comentarios,
            dataAssinatura,
        });
    } catch (err) {
        console.error('[aluno/faa] erro ao salvar ficha:', err.message);
        setFlash(req, 'error', 'Não foi possível salvar a ficha da FAA. Tente novamente.');
        return res.redirect('/aluno/faa');
    }

    if (acao === 'salvar') {
        setFlash(req, 'success', 'Ficha salva. Você pode alterá-la e gerar o PDF quando quiser.');
        return res.redirect('/aluno/faa');
    }

    try {
        const pdfBytes = await gerarFaaPdf({
            aluno: req.aluno,
            empresa,
            periodo,
            notas,
            atividades,
            respostas,
            comentarios,
            dataAssinatura,
        });

        return enviarPdf(res, req.aluno.nome, pdfBytes);
    } catch (err) {
        console.error('[aluno/faa] erro ao gerar PDF:', err.message);
        setFlash(req, 'error', 'A ficha foi salva, mas não foi possível gerar o PDF. Tente novamente.');
        return res.redirect('/aluno/faa');
    }
});

router.get('/faa/pdf', requireEstagioConcluido, async (req, res) => {
    const faa = await faasModel.buscarPorAluno(req.session.user.id);

    if (!faa) {
        setFlash(req, 'error', 'Salve a ficha da FAA antes de gerar o PDF.');
        return res.redirect('/aluno/faa');
    }

    try {
        const pdfBytes = await gerarFaaPdf({
            aluno: req.aluno,
            empresa: req.aluno.empresa || faa.empresa,
            periodo: faa.periodo,
            notas: faa.notas,
            atividades: faa.atividades,
            respostas: faa.respostas,
            comentarios: faa.comentarios,
            dataAssinatura: dataParaInput(faa.data_assinatura),
        });

        return enviarPdf(res, req.aluno.nome, pdfBytes);
    } catch (err) {
        console.error('[aluno/faa/pdf] erro ao gerar PDF:', err.message);
        setFlash(req, 'error', 'Não foi possível gerar o PDF da FAA. Tente novamente.');
        return res.redirect('/aluno/faa');
    }
});

router.get('/fapo/pdf', requireEstagioConcluido, async (req, res) => {
    const fapo = await faposModel.buscarPorAluno(req.session.user.id);

    if (!fapo) {
        setFlash(req, 'error', 'A FAPO ainda não foi avaliada pelo seu orientador.');
        return res.redirect('/aluno/dashboard');
    }

    try {
        const pdfBytes = await gerarFapoPdf({
            aluno: req.aluno,
            empresa: req.aluno.empresa || '',
            nota: Number(fapo.nota),
            comentarios: fapo.comentarios,
            dataAssinatura: dataParaInput(fapo.data_assinatura),
        });

        return enviarPdf(res, req.aluno.nome, pdfBytes);
    } catch (err) {
        console.error('[aluno/fapo/pdf] erro ao gerar PDF:', err.message);
        setFlash(req, 'error', 'Não foi possível gerar o PDF da FAPO. Tente novamente.');
        return res.redirect('/aluno/dashboard');
    }
});

router.get('/ficha-acompanhamento', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.session.user.id);
    const atividades = await atividadesModel.listarPorAluno(req.session.user.id);

    try {
        const pdfBytes = await gerarFichaAcompanhamentoPdf({
            aluno,
            atividades,
        });

        const nomeBase = String(aluno.nome)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'aluno';

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Ficha-Acompanhamento-${nomeBase}.pdf"`);
        return res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('[aluno/ficha-acompanhamento] erro ao gerar PDF:', err.message);
        setFlash(req, 'error', 'Não foi possível gerar o PDF da ficha de acompanhamento. Tente novamente.');
        return res.redirect('/aluno/atividades');
    }
});

router.get('/atividades', async (req, res) => {
    const aluno = await alunosModel.buscarPorUsuarioId(req.session.user.id);
    const atividades = await atividadesModel.listarPorAluno(req.session.user.id);

    const horasRealizadas = Number(aluno.horas_realizadas);
    const horasPendentes = Number(aluno.horas_pendentes);
    const cargaHoraria = aluno.carga_horaria;
    const percentual = cargaHoraria > 0 ? Math.min(100, Math.round((horasRealizadas / cargaHoraria) * 100)) : 0;

    res.render('aluno_atividades', {
        atividades,
        horasRealizadas,
        horasPendentes,
        cargaHoraria,
        horasRestantes: Math.max(0, cargaHoraria - horasRealizadas),
        percentual,
        status: aluno.status,
    });
});

// só acessível com o estágio em andamento (lista de espera / concluído são bloqueados)
router.get('/nova-atividade', requireEmAndamento, (req, res) => {
    res.render('aluno_nova_atividade');
});

router.post('/nova-atividade', requireEmAndamento, async (req, res) => {
    const { data, hora_inicio, hora_fim, horas, descricao } = req.body;

    if (!data || !hora_inicio || !hora_fim || !horas || !descricao) {
        setFlash(req, 'error', 'Preencha todos os campos da atividade.');
        return res.redirect('/aluno/nova-atividade');
    }

    await atividadesModel.criar({
        alunoId: req.session.user.id,
        data,
        horaInicio: hora_inicio,
        horaFim: hora_fim,
        horas: Number(horas),
        descricao: descricao.trim(),
    });

    setFlash(req, 'success', 'Atividade registrada com sucesso.');
    res.redirect('/aluno/atividades');
});

module.exports = router;
