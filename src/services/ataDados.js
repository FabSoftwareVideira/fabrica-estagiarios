// Reúne os dados que alimentam a ata da banca (FARE).
const atividadesModel = require('../models/atividades');
const faasModel = require('../models/faas');
const faposModel = require('../models/fapos');
const faresModel = require('../models/fares');
const { notaDaFaa } = require('../utils/ata');
const { periodoDasAtividades } = require('../utils/datas');

async function montarContexto(aluno) {
    const [fapo, faa, fare, atividades] = await Promise.all([
        faposModel.buscarPorAluno(aluno.usuario_id),
        faasModel.buscarPorAluno(aluno.usuario_id),
        faresModel.buscarPorAluno(aluno.usuario_id),
        atividadesModel.listarPorAluno(aluno.usuario_id),
    ]);
    return { fapo, faa, fare, atividades };
}

function dadosParaPdf({ aluno, fapo, faa, fare, atividades, orientadorNome }) {
    const notaFaa = faa ? notaDaFaa(faa) : fare.nota_faa_manual;
    return {
        aluno,
        empresa: aluno.empresa || '',
        periodo: fare.periodo || periodoDasAtividades(atividades),
        horas: Number(aluno.horas_realizadas),
        fac: fare.nota_fac,
        fapo: fapo ? fapo.nota : null,
        faa: notaFaa,
        banca: fare.banca,
        avaliador1: fare.avaliador_1,
        avaliador2: fare.avaliador_2,
        orientadorNome: orientadorNome || aluno.orientador_nome || '',
        resultado: fare.resultado,
        corrigirRelatorioAte: fare.corrigir_relatorio_ate,
        refazerApresentacaoAte: fare.refazer_apresentacao_ate,
        comentarios: fare.comentarios,
        dataAta: fare.data_ata,
    };
}

module.exports = { montarContexto, dadosParaPdf };
