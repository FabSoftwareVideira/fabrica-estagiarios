const router = require('express').Router();
const { setFlash } = require('../middleware/auth');
const alunos = require('../models/alunos');
const atividades = require('../models/atividades');
const facs = require('../models/facs');
const { CRITERIOS_FAC, lerFac } = require('../utils/fac');
const { dataParaInput, dataLocalIso, periodoDasAtividades, nomeParaArquivo } = require('../utils/datas');
const { gerarFacPdf } = require('../services/facPdf');

async function carregar(req, res, next) {
    const aluno = await alunos.buscarPorUsuarioId(req.params.id);
    const user = req.session.user;
    if (!aluno || ![aluno.supervisor_id, aluno.orientador_id].some((id) => Number(id) === Number(user.id)) && user.cargo !== 'admin') {
        return res.status(403).send('Você não tem acesso à avaliação deste estudante.');
    }
    req.aluno = aluno;
    next();
}

function podeEditar(aluno, user) {
    return Number(aluno.supervisor_id) === Number(user.id) && aluno.status === 'concluido'
        && !aluno.encerrado_em && !aluno.arquivado;
}

async function renderizar(req, res, valores, erros = []) {
    const fac = await facs.buscarPorAluno(req.aluno.usuario_id);
    const registros = await atividades.listarPorAluno(req.aluno.usuario_id);
    res.render('professor_fac', {
        aluno: req.aluno, fac, erros, criterios: CRITERIOS_FAC,
        podeEditar: podeEditar(req.aluno, req.session.user),
        valores: valores || (fac ? { ...fac, data_assinatura: dataParaInput(fac.data_assinatura) } : {
            empresa: req.aluno.empresa || '', curso: '', periodo: periodoDasAtividades(registros),
            notas: Array(10).fill(''), atividades: '', comentarios: '', local_assinatura: '', data_assinatura: dataLocalIso(),
        }),
    });
}

router.get('/aluno/:id/fac', carregar, (req, res) => renderizar(req, res));
router.post('/aluno/:id/fac', carregar, async (req, res) => {
    if (!podeEditar(req.aluno, req.session.user)) return res.status(403).send('A avaliação não pode ser alterada.');
    const { valores, erros } = lerFac(req.body);
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
    const bytes = await gerarFacPdf({ aluno: req.aluno, fac });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="FAC-${nomeParaArquivo(req.aluno.nome)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store, private');
    res.send(Buffer.from(bytes));
});
module.exports = router;
