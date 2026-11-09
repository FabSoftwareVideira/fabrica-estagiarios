// Rótulo e classe visual do estágio. "concluido" no banco significa que as
// horas foram cumpridas; o estágio só é de fato encerrado quando o orientador
// conclui a ata da banca (encerrado_em).

function estagioStatus(aluno) {
    if (!aluno) return { chave: 'indefinido', label: '—', classe: 'status-waiting' };

    if (aluno.arquivado) {
        return { chave: 'arquivado', label: 'Arquivado', classe: 'status-archived' };
    }
    if (aluno.status === 'lista_espera') {
        return { chave: 'lista_espera', label: 'Lista de espera', classe: 'status-waiting' };
    }
    if (aluno.status === 'em_andamento') {
        return { chave: 'em_andamento', label: 'Em andamento', classe: 'status-progress' };
    }
    if (aluno.encerrado_em) {
        return { chave: 'encerrado', label: 'Encerrado', classe: 'status-completed' };
    }
    return { chave: 'aguardando_banca', label: 'Aguardando banca', classe: 'status-banca' };
}

// etapas mostradas na trilha do estágio (do ponto de vista do aluno)
const ETAPAS = [
    { chave: 'cadastro', titulo: 'Cadastro' },
    { chave: 'atividades', titulo: 'Atividades' },
    { chave: 'fichas', titulo: 'Fichas e banca' },
    { chave: 'encerrado', titulo: 'Encerrado' },
];

// índice (0 a 3) da etapa atual
function etapaAtual(aluno) {
    if (!aluno || aluno.status === 'lista_espera') return 0;
    if (aluno.status === 'em_andamento') return 1;
    if (aluno.status === 'concluido' && !aluno.encerrado_em) return 2;
    return 3;
}

module.exports = { estagioStatus, etapaAtual, ETAPAS };
