const fs = require('fs/promises');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const TEMPLATE_PATH = path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'Ficha de acompanhamento.pdf'
);

function formatarDataBr(valor) {
    if (!valor) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        const [ano, mes, dia] = valor.split('-');
        return `${dia}/${mes}/${ano}`;
    }
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return String(valor);
    return data.toLocaleDateString('pt-BR');
}

function formatarHora(valor) {
    if (!valor) return '';
    return String(valor).substring(0, 5); // HH:MM
}

async function gerarFichaAcompanhamentoPdf({ aluno, atividades }) {
    const templateBytes = await fs.readFile(TEMPLATE_PATH);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    // Preencher dados do aluno
    const empresaField = form.getTextField('empresa');
    // TODO: Obter empresa de algum lugar (FAA, FAPRO, ou solicitar no formulário)
    empresaField.setText(''); // Deixar em branco por enquanto conforme solicitado
    
    const nomeEstagiarioField = form.getTextField('nome_estagiario');
    nomeEstagiarioField.setText(aluno.nome || '');

    // Preencher atividades (máximo de 16 registros)
    const atividadesLimitadas = atividades.slice(0, 16);
    
    atividadesLimitadas.forEach((atividade, index) => {
        const num = String(index + 1).padStart(2, '0');
        
        const dataField = form.getTextField(`data_${num}`);
        dataField.setText(formatarDataBr(atividade.data) || '');
        
        const entradaField = form.getTextField(`entrada_${num}`);
        entradaField.setText(formatarHora(atividade.hora_inicio) || '');
        
        const saidaField = form.getTextField(`saida_${num}`);
        saidaField.setText(formatarHora(atividade.hora_fim) || '');
        
        const atividadeField = form.getTextField(`atividade_${num}`);
        atividadeField.setText(atividade.descricao || '');
        
        const horasField = form.getTextField(`horas_${num}`);
        horasField.setText(atividade.horas ? String(atividade.horas).replace('.', ',') : '');
        
        const rubricaField = form.getTextField(`rubrica_${num}`);
        rubricaField.setText(''); // Deixar em branco conforme solicitado
    });

    // Preencher totais
    const totalHoras = atividades.reduce((sum, atividade) => sum + parseFloat(atividade.horas || 0), 0);
    const totalHorasField = form.getTextField('total_horas_estagio');
    totalHorasField.setText(totalHoras.toFixed(2).replace('.', ','));

    // Preencher data do último dia (última atividade)
    if (atividades.length > 0) {
        const datasOrdenadas = atividades
            .map(a => new Date(a.data))
            .filter(d => !isNaN(d))
            .sort((a, b) => b - a);
        
        if (datasOrdenadas.length > 0) {
            const ultimaDataField = form.getTextField('data_ultimo_dia');
            ultimaDataField.setText(formatarDataBr(datasOrdenadas[0]) || '');
        }
    }

    // Preencher assinaturas
    const assinaturaEstagiarioField = form.getTextField('assinatura_estagiario');
    assinaturaEstagiarioField.setText(''); // Será preenchido manualmente
    
    const assinaturaSupervisorField = form.getTextField('assinatura_supervisor');
    assinaturaSupervisorField.setText(''); // Será preenchido manualmente

    // Preencher observações
    const observacoesField = form.getTextField('observacoes');
    observacoesField.setText('');

    // Limpar campos extras se houver menos de 16 atividades
    if (atividadesLimitadas.length < 16) {
        for (let i = atividadesLimitadas.length + 1; i <= 16; i++) {
            const num = String(i).padStart(2, '0');
            
            const dataField = form.getTextField(`data_${num}`);
            dataField.setText('');
            
            const entradaField = form.getTextField(`entrada_${num}`);
            entradaField.setText('');
            
            const saidaField = form.getTextField(`saida_${num}`);
            saidaField.setText('');
            
            const atividadeField = form.getTextField(`atividade_${num}`);
            atividadeField.setText('');
            
            const horasField = form.getTextField(`horas_${num}`);
            horasField.setText('');
            
            const rubricaField = form.getTextField(`rubrica_${num}`);
            rubricaField.setText('');
        }
    }

    return pdfDoc.save();
}

module.exports = { gerarFichaAcompanhamentoPdf };
