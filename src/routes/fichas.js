// Área de Fichas do orientador: FAPO (já existente em professor.js), ata da
// banca (FARE) e emissão de documentos. Montado dentro de /professor, depois
// de requireRole('professor') e requireNomeConfirmado.

const router = require('express').Router();
const { setFlash } = require('../middleware/auth');
const alunosModel = require('../models/alunos');
const atividadesModel = require('../models/atividades');
const faasModel = require('../models/faas');
const faposModel = require('../models/fapos');
const facsModel = require('../models/facs');
const bancasModel = require('../models/bancas');
const faresModel = require('../models/fares');
const { gerarFarePdf } = require('../services/farePdf');
const { montarContexto, dadosParaPdf } = require('../services/ataDados');
const { gerarFaaPdf } = require('../services/faaPdf');
const { gerarFichaAcompanhamentoPdf } = require('../services/fichaAcompanhamentoPdf');
const { CRITERIOS_BANCA, RESULTADOS, ehNumero, notaDaFaa, calcularAta } = require('../utils/ata');
const { dataLocalIso, dataIsoValida, dataParaInput, nomeParaArquivo, periodoDasAtividades } = require('../utils/datas');

function enviarPdf(res, prefixo, nome, bytes) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${prefixo}-${nomeParaArquivo(nome)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.send(Buffer.from(bytes));
}

// ── Painel de fichas ──────────────────────────────────────────────────────
router.get('/fichas', async (req, res) => {
    const orientandos = await faresModel.listarPorOrientador(req.session.user.id);

    res.render('professor_fichas', {
        supervisionados: await facsModel.listarPorSupervisor(req.session.user.id),
        prontos: orientandos.filter((o) => o.status === 'concluido' && !o.encerrado_em),
        andamento: orientandos.filter((o) => o.status === 'em_andamento'),
        encerrados: orientandos.filter((o) => o.encerrado_em),
        RESULTADOS,
    });
});

// ── Guardas ──────────────────────────────────────────────────────────────
async function carregarAluno(req, res, next) {
    const aluno = await alunosModel.buscarPorUsuarioId(req.params.id);
    if (!aluno) {
        setFlash(req, 'error', 'Aluno não encontrado.');
        return res.redirect('/professor/dashboard');
    }
    req.aluno = aluno;
    next();
}

// a ata é feita pelo orientador do aluno, depois das horas cumpridas
function requireOrientadorAta(req, res, next) {
    const { aluno } = req;
    if (aluno.status !== 'concluido') {
        setFlash(req, 'error', 'A ata só pode ser preenchida depois que o aluno cumprir todas as horas.');
        return res.redirect('/professor/aluno/' + aluno.usuario_id);
    }
    if (Number(aluno.orientador_id) !== Number(req.session.user.id)) {
        setFlash(req, 'error', 'Apenas o professor orientador do aluno pode preencher a ata da banca.');
        return res.redirect('/professor/aluno/' + aluno.usuario_id);
    }
    next();
}

// ── Ata da banca (FARE) ──────────────────────────────────────────────────
router.get('/aluno/:id/fare', carregarAluno, requireOrientadorAta, async (req, res) => {
    const { aluno } = req;
    const { fapo, faa, fare, atividades, fac } = await montarContexto(aluno);
    const agendamento = await bancasModel.buscarPorAluno(aluno.usuario_id);
    const bancaAtiva = agendamento && agendamento.situacao !== 'cancelada' ? agendamento : null;
    const rascunho = req.session.fareForm || null;
    delete req.session.fareForm;

    const base = fare || {
        periodo: periodoDasAtividades(atividades),
        nota_fac: null,
        nota_faa_manual: null,
        banca: [[null, null, null], [null, null, null], [null, null, null]],
        avaliador_1: bancaAtiva?.avaliador_1_nome || '',
        avaliador_2: bancaAtiva?.avaliador_2_nome || '',
        resultado: null,
        corrigir_relatorio_ate: '',
        refazer_apresentacao_ate: '',
        comentarios: '',
        data_ata: bancaAtiva?.data || dataLocalIso(),
    };
    const valores = rascunho ? { ...base, ...rascunho } : base;
    if (fac && !aluno.encerrado_em) valores.nota_fac = fac.nota;
    if (!valores.data_ata) valores.data_ata = dataLocalIso();

    res.render('professor_fare', {
        aluno,
        encerrado: Boolean(aluno.encerrado_em),
        fare,
        fapo,
        fac,
        faa,
        notaFaa: faa ? notaDaFaa(faa) : null,
        valores,
        criterios: CRITERIOS_BANCA,
        RESULTADOS,
        orientadorNome: req.session.user.nome,
        calculo: calcularAta({
            fac: valores.nota_fac,
            fapo: fapo ? fapo.nota : null,
            faa: faa ? notaDaFaa(faa) : valores.nota_faa_manual,
            banca: valores.banca,
        }),
    });
});

function lerNota(valor, rotulo, erros) {
    const bruto = String(valor ?? '').trim().replace(',', '.');
    if (bruto === '') return null;
    const n = Number(bruto);
    if (!Number.isFinite(n) || n < 0 || n > 10) {
        erros.push(`${rotulo} deve estar entre 0 e 10`);
        return null;
    }
    return Math.round(n * 10) / 10;
}

function lerData(valor, rotulo, erros) {
    const iso = String(valor || '').trim();
    if (!iso) return '';
    if (!dataIsoValida(iso)) {
        erros.push(`${rotulo} é inválida`);
        return '';
    }
    return iso;
}

router.post('/aluno/:id/fare', carregarAluno, requireOrientadorAta, async (req, res) => {
    const { aluno } = req;
    const voltar = `/professor/aluno/${aluno.usuario_id}/fare`;

    if (aluno.encerrado_em) {
        setFlash(req, 'error', 'Este estágio já foi encerrado. Reabra a ata para alterar.');
        return res.redirect(voltar);
    }

    const fac = await facsModel.buscarPorAluno(aluno.usuario_id);
    const finalizar = req.body.acao === 'finalizar';
    const erros = [];

    const resultado = Object.keys(RESULTADOS).includes(req.body.resultado) ? req.body.resultado : null;
    const ressalva = resultado === 'aprovado_ressalva';

    const corrigirMarcado = ressalva && req.body.corrigir_relatorio === 'on';
    const refazerMarcado = ressalva && req.body.refazer_apresentacao === 'on';

    const valores = {
        periodo: String(req.body.periodo || '').trim().slice(0, 80),
        nota_fac: fac ? fac.nota : lerNota(req.body.nota_fac, 'A nota da FAC', erros),
        nota_faa_manual: lerNota(req.body.nota_faa_manual, 'A nota da FAA', erros),
        banca: CRITERIOS_BANCA.map((criterio, i) =>
            [1, 2, 3].map((n) => lerNota(req.body[`banca_${i + 1}_${n}`], `A nota de ${criterio.titulo.toLowerCase()} (N${n})`, erros))),
        avaliador_1: String(req.body.avaliador_1 || '').trim().slice(0, 150),
        avaliador_2: String(req.body.avaliador_2 || '').trim().slice(0, 150),
        resultado,
        corrigir_relatorio_ate: corrigirMarcado ? lerData(req.body.corrigir_relatorio_ate, 'A data para corrigir o relatório', erros) : '',
        refazer_apresentacao_ate: refazerMarcado ? lerData(req.body.refazer_apresentacao_ate, 'A data para refazer a apresentação', erros) : '',
        comentarios: String(req.body.comentarios || '').trim().slice(0, 600),
        data_ata: lerData(req.body.data_ata, 'A data da ata', erros),
    };

    const lembrarFormulario = () => {
        req.session.fareForm = valores;
    };

    if (erros.length > 0) {
        lembrarFormulario();
        setFlash(req, 'error', `${erros[0]}.`);
        return res.redirect(voltar);
    }

    const fapo = await faposModel.buscarPorAluno(aluno.usuario_id);
    const faa = await faasModel.buscarPorAluno(aluno.usuario_id);

    if (finalizar) {
        const faltando = [];
        if (!valores.periodo) faltando.push('período do estágio');
        if (!fapo) faltando.push('FAPO (preencha antes a ficha do orientador)');
        if (valores.nota_fac === null) faltando.push('nota da FAC');
        if (!faa && valores.nota_faa_manual === null) faltando.push('nota da FAA');
        if (valores.banca.some((linha) => linha.some((n) => !ehNumero(n)))) faltando.push('as 9 notas da banca');
        if (!valores.avaliador_1 || !valores.avaliador_2) faltando.push('nome dos dois avaliadores');
        if (!valores.resultado) faltando.push('resultado da banca');
        if (ressalva && !valores.corrigir_relatorio_ate && !valores.refazer_apresentacao_ate) {
            faltando.push('o que o aluno deve fazer na ressalva, com a data limite');
        }
        if (!valores.data_ata) faltando.push('data da ata');

        if (faltando.length > 0) {
            lembrarFormulario();
            setFlash(req, 'error', `Para concluir o estágio, falta: ${faltando.join('; ')}.`);
            return res.redirect(voltar);
        }
    }

    try {
        await faresModel.salvar({
            alunoId: aluno.usuario_id,
            periodo: valores.periodo,
            notaFac: valores.nota_fac,
            // só vale quando o aluno não preencheu a FAA no sistema
            notaFaaManual: faa ? null : valores.nota_faa_manual,
            banca: valores.banca,
            avaliador1: valores.avaliador_1,
            avaliador2: valores.avaliador_2,
            resultado: valores.resultado,
            corrigirRelatorioAte: valores.corrigir_relatorio_ate,
            refazerApresentacaoAte: valores.refazer_apresentacao_ate,
            comentarios: valores.comentarios,
            dataAta: valores.data_ata,
        });

        if (finalizar) {
            await faresModel.encerrar(aluno.usuario_id);
            setFlash(req, 'success', 'Estágio concluído. A ata está pronta para impressão e o aluno agora só pode consultar e imprimir os documentos.');
        } else {
            setFlash(req, 'success', 'Rascunho da ata salvo.');
        }
    } catch (err) {
        console.error('[professor/fare] erro ao salvar ata:', err.message);
        lembrarFormulario();
        setFlash(req, 'error', 'Não foi possível salvar a ata. Tente novamente.');
    }
    res.redirect(voltar);
});

router.get('/aluno/:id/fare/pdf', carregarAluno, async (req, res) => {
    const { aluno } = req;
    if (Number(aluno.orientador_id) !== Number(req.session.user.id)) {
        setFlash(req, 'error', 'Apenas o professor orientador do aluno pode gerar a ata.');
        return res.redirect('/professor/aluno/' + aluno.usuario_id);
    }

    const contexto = await montarContexto(aluno);
    if (!contexto.fare) {
        setFlash(req, 'error', 'Salve a ata antes de gerar o PDF.');
        return res.redirect(`/professor/aluno/${aluno.usuario_id}/fare`);
    }

    try {
        const bytes = await gerarFarePdf(dadosParaPdf({ aluno, ...contexto, orientadorNome: req.session.user.nome }));
        return enviarPdf(res, 'Ata-Banca', aluno.nome, bytes);
    } catch (err) {
        console.error('[professor/fare/pdf] erro ao gerar PDF:', err.message);
        setFlash(req, 'error', 'Não foi possível gerar o PDF da ata. Tente novamente.');
        return res.redirect(`/professor/aluno/${aluno.usuario_id}/fare`);
    }
});

// reabrir: o orientador (ou um admin) desfaz o encerramento para corrigir algo
router.post('/aluno/:id/fare/reabrir', carregarAluno, async (req, res) => {
    const { aluno } = req;
    const ehOrientador = Number(aluno.orientador_id) === Number(req.session.user.id);
    if (!ehOrientador && req.session.user.cargo !== 'admin') {
        setFlash(req, 'error', 'Apenas o orientador ou um administrador pode reabrir o estágio.');
        return res.redirect('/professor/aluno/' + aluno.usuario_id);
    }

    await faresModel.reabrir(aluno.usuario_id);
    setFlash(req, 'success', 'Estágio reaberto. O aluno volta a poder editar a FAA e a ata pode ser alterada.');
    res.redirect(ehOrientador ? `/professor/aluno/${aluno.usuario_id}/fare` : '/professor/aluno/' + aluno.usuario_id);
});

// ── Documentos do aluno para impressão (qualquer professor) ───────────────
router.get('/aluno/:id/ficha-acompanhamento', carregarAluno, async (req, res) => {
    const atividades = await atividadesModel.listarPorAluno(req.aluno.usuario_id);
    try {
        const bytes = await gerarFichaAcompanhamentoPdf({ aluno: req.aluno, atividades });
        return enviarPdf(res, 'Ficha-Acompanhamento', req.aluno.nome, bytes);
    } catch (err) {
        console.error('[professor/ficha-acompanhamento] erro:', err.message);
        setFlash(req, 'error', 'Não foi possível gerar a ficha de acompanhamento.');
        return res.redirect('/professor/aluno/' + req.aluno.usuario_id);
    }
});

router.get('/aluno/:id/faa/pdf', carregarAluno, async (req, res) => {
    const faa = await faasModel.buscarPorAluno(req.aluno.usuario_id);
    if (!faa) {
        setFlash(req, 'error', 'O aluno ainda não preencheu a FAA.');
        return res.redirect('/professor/aluno/' + req.aluno.usuario_id);
    }
    try {
        const bytes = await gerarFaaPdf({
            aluno: req.aluno,
            empresa: req.aluno.empresa || faa.empresa,
            periodo: faa.periodo,
            notas: faa.notas,
            atividades: faa.atividades,
            respostas: faa.respostas,
            comentarios: faa.comentarios,
            dataAssinatura: dataParaInput(faa.data_assinatura),
        });
        return enviarPdf(res, 'FAA', req.aluno.nome, bytes);
    } catch (err) {
        console.error('[professor/faa/pdf] erro:', err.message);
        setFlash(req, 'error', 'Não foi possível gerar o PDF da FAA.');
        return res.redirect('/professor/aluno/' + req.aluno.usuario_id);
    }
});

module.exports = router;
