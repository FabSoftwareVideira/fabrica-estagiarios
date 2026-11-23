const { pool } = require('../config/database');
const { setFlash } = require('../middleware/auth');

function conferirFormulario(req, res, voltar) {
    const versao = req.body && req.body.versao_estagio;
    if ((versao === undefined && Number(req.aluno.versao_estagio) === 0)
        || String(versao) === String(req.aluno.versao_estagio)) return true;
    setFlash(req, 'error', 'O estágio foi alterado. Atualize a página antes de enviar o formulário.');
    res.redirect(voltar);
    return false;
}

async function comEstagioAtual(alunoId, contexto, executar) {
    if (!contexto) return executar(pool);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM alunos WHERE usuario_id = $1 FOR UPDATE', [alunoId]);
        const aluno = rows[0];
        if (!aluno || Number(aluno.versao_estagio) !== Number(contexto.versao)
            || aluno.status !== 'concluido' || aluno.encerrado_em || aluno.arquivado
            || (contexto.papel && Number(aluno[contexto.papel]) !== Number(contexto.usuarioId))) {
            throw Object.assign(new Error('O estágio foi alterado. Atualize a página antes de continuar.'), { status: 409 });
        }
        const resultado = await executar(client);
        await client.query('COMMIT');
        return resultado;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = { conferirFormulario, comEstagioAtual };
