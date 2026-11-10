const router = require('express').Router();
const { setFlash } = require('../middleware/auth');
const alunos = require('../models/alunos');
const atividades = require('../models/atividades');
const facs = require('../models/facs');
const fichasRascunhos = require('../models/fichasRascunhos');
const { CRITERIOS_FAC, lerFac } = require('../utils/fac');
const { dataParaInput, dataLocalIso, periodoDasAtividades, nomeParaArquivo } = require('../utils/datas');
const { gerarFacPdf } = require('../services/facPdf');
const { veTodosOsEstagios } = require('../config/papeis');

async function carregar(req, res, next) {
    const aluno = await alunos.buscarPorUsuarioId(req.params.id);
    const user = req.session.user;
    if (!aluno || ![aluno.supervisor_id, aluno.orientador_id].some((id) => Number(id) === Number(user.id)) && !veTodosOsEstagios(user)) {
        return res.status(403).send('Você não tem acesso à avaliação deste estudante.');
    }
    req.aluno = aluno;
    next();
}

function ataEmitida(aluno) {
    return Boolean(aluno.encerrado_em);
}

function podeEditar(aluno, user) {
    // A FAC só pode ser alterada enquanto a ata da banca não foi emitida;
    // ao concluir o estágio o orientador grava encerrado_em e a ficha trava.
    return Number(aluno.supervisor_id) === Number(user.id) && aluno.status === 'concluido'
        && !ataEmitida(aluno) && !aluno.arquivado && Boolean(aluno.curso);
}

async function renderizar(req, res, valores, erros = []) {
    const fac = await facs.buscarPorAluno(req.aluno.usuario_id);
    // depois da ata emitida a ficha é somente leitura: ignora rascunhos antigos
    const rascunhoSalvo = ataEmitida(req.aluno)
        ? null
        : await fichasRascunhos.buscar(req.aluno.usuario_id, 'FAC');
    const registros = await atividades.listarPorAluno(req.aluno.usuario_id);
    const base = fac ? { ...fac, curso: req.aluno.curso || fac.curso, data_assinatura: dataParaInput(fac.data_assinatura) } : {
        empresa: (req.aluno.empresa || '').slice(0, 60), curso: req.aluno.curso || '', periodo: periodoDasAtividades(registros),
        notas: Array(10).fill(''), atividades: '', comentarios: '', local_assinatura: '', data_assinatura: dataLocalIso(),
    };
    const dadosRascunho = rascunhoSalvo?.dados;
    const valoresIniciais = dadosRascunho
        ? { ...base, ...dadosRascunho, curso: req.aluno.curso || '', notas: dadosRascunho.notas || base.notas }
        : base;
    res.render('professor_fac', {
        aluno: req.aluno, fac, erros, criterios: CRITERIOS_FAC, rascunhoSalvo,
        podeEditar: podeEditar(req.aluno, req.session.user),
        ataEmitida: ataEmitida(req.aluno),
        valores: valores || valoresIniciais,
    });
}

router.get('/aluno/:id/fac', carregar, (req, res) => renderizar(req, res));
router.post('/aluno/:id/fac', carregar, async (req, res) => {
    if (!podeEditar(req.aluno, req.session.user)) return res.status(403).send('A avaliação não pode ser alterada.');
    if (req.body.acao === 'rascunho') {
        const campo = (valor, limite) => typeof valor === 'string' ? valor.slice(0, limite) : '';
        const dados = {
            empresa: campo(req.body.empresa, 200),
            periodo: campo(req.body.periodo, 80),
            notas: Array.from({ length: 10 }, (_, i) => campo(req.body[`nota_${i}`], 10)),
            atividades: campo(req.body.atividades, 300),
            comentarios: campo(req.body.comentarios, 300),
            local_assinatura: campo(req.body.local_assinatura, 80),
            data_assinatura: campo(req.body.data_assinatura, 10),
        };
        try {
            await fichasRascunhos.salvar(req.aluno.usuario_id, 'FAC', dados);
            setFlash(req, 'success', 'Rascunho da FAC salvo. Você poderá continuar o preenchimento mais tarde.');
            return res.redirect(`/professor/aluno/${req.aluno.usuario_id}/fac`);
        } catch (err) {
            console.error('[professor/fac] erro ao salvar rascunho:', err.message);
            setFlash(req, 'error', 'Não foi possível salvar o rascunho da FAC. Tente novamente.');
            return res.redirect(`/professor/aluno/${req.aluno.usuario_id}/fac`);
        }
    }
    const { valores, erros } = lerFac(req.body, req.aluno.curso);
    if (erros.length) return renderizar(req, res.status(422), valores, erros);
    if (!await facs.salvar(req.aluno.usuario_id, req.session.user, valores)) {
        return res.status(409).send('O estágio foi alterado. Atualize a página antes de continuar.');
    }
    setFlash(req, 'success', 'Avaliação do supervisor salva. A média será utilizada na ata da banca.');
    res.redirect(`/professor/aluno/${req.aluno.usuario_id}/fac`);
});
router.get('/aluno/:id/fac/pdf', carregar, async (req, res) => {
    const fac = await facs.buscarPorAluno(req.aluno.usuario_id);
    if (!fac) {
        setFlash(req, 'error', 'Preencha a avaliação antes de gerar o PDF.');
        return res.redirect(`/professor/aluno/${req.aluno.usuario_id}/fac`);
    }
    const bytes = await gerarFacPdf({ aluno: req.aluno, fac: { ...fac, curso: req.aluno.curso || fac.curso } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="FAC-${nomeParaArquivo(req.aluno.nome)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store, private');
    res.send(Buffer.from(bytes));
});
module.exports = router;
