// Ambiente de integração compartilhado pelos testes.
//
// - Banco PGlite em memória com o schema completo (init.sql + migrações).
// - O pool da aplicação passa a usar esse banco; conexões com transação são
//   servidas uma por vez, como num pool de tamanho 1.
// - A aplicação monta as mesmas rotas de src/app.js, mas com uma sessão em
//   memória escolhida por cabeçalho, para os testes entrarem como qualquer
//   pessoa e lerem a mensagem (flash) deixada depois de um redirecionamento.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { pool } = require('../../src/config/database');

const RAIZ = path.join(__dirname, '..', '..');
const CURSO = 'Curso Técnico em Informática Integrado ao Ensino Médio';

// O driver pg (produção) devolve DATE como meia-noite no fuso local; o PGlite
// devolveria meia-noite UTC. Usa a regra do pg para o teste ver o mesmo dia.
const PARSERS_COMO_PG = {
    1082: (valor) => {
        const [ano, mes, dia] = valor.split('-').map(Number);
        return new Date(ano, mes - 1, dia);
    },
};

async function criarBanco() {
    const db = new PGlite({ parsers: PARSERS_COMO_PG });
    await db.exec(fs.readFileSync(path.join(RAIZ, 'db/init.sql'), 'utf8'));
    const migracoes = fs.readdirSync(path.join(RAIZ, 'db/migrations')).sort()
        .filter((nome) => nome.endsWith('.sql') && Number(nome.slice(0, 3)) > 10);
    for (const nome of migracoes) {
        await db.exec(fs.readFileSync(path.join(RAIZ, 'db/migrations', nome), 'utf8'));
    }
    return db;
}

function ligarPool(db) {
    async function consultar(sql, params) {
        // instância isolada: os advisory locks dos jobs sempre são obtidos
        if (/pg_(try_advisory_lock|advisory_unlock)/.test(sql)) return { rows: [{ adquirido: true }], rowCount: 1 };
        const r = await db.query(sql, params);
        return { ...r, rowCount: r.affectedRows ?? r.rows.length };
    }
    let fila = Promise.resolve();
    pool.query = consultar;
    pool.connect = async () => {
        const anterior = fila;
        let liberar;
        fila = new Promise((resolve) => { liberar = resolve; });
        await anterior;
        return { query: consultar, release: liberar };
    };
    return consultar;
}

// Elenco fixo usado pelos testes. Ids de pessoas internas: 10-19; estudantes: 200+.
const PESSOAS = {
    admin: 10, servidora: 11, orientadora: 12, supervisor: 13, externo: 14,
    externoPendente: 15, outroProfessor: 16, semNome: 17,
    ana: 201, bruno: 202, carla: 203, davi: 204, eva: 205, fabio: 206,
};

const SEMENTE = `
TRUNCATE usuarios, estagios_rascunhos, envios_relatorios_semanais RESTART IDENTITY CASCADE;
UPDATE configuracoes_relatorio_semanal SET habilitado = false, dia_semana = 1, horario = '08:00', ultimo_envio_semana = NULL WHERE id = 1;
INSERT INTO usuarios (id, nome, email, tipo, nome_confirmado) VALUES
  (10, 'Alice Admin', 'admin@ifc.edu.br', 'professor', true),
  (11, 'Sara Servidora', 'servidora@ifc.edu.br', 'professor', true),
  (12, 'Olga Orientadora', 'orientadora@ifc.edu.br', 'professor', true),
  (13, 'Saulo Supervisor', 'supervisor@ifc.edu.br', 'professor', true),
  (14, 'Elisa Externa', 'elisa@empresa.test', 'professor', true),
  (15, 'Pedro Pendente', 'pedro@empresa.test', 'professor', true),
  (16, 'Otto Outro', 'outro@ifc.edu.br', 'professor', true),
  (17, 'prof', 'prof@ifc.edu.br', 'professor', false),
  (201, 'Ana Andrade', 'ana@estudante.test', 'aluno', true),
  (202, 'Bruno Brito', 'bruno@estudante.test', 'aluno', true),
  (203, 'Carla Costa', 'carla@estudante.test', 'aluno', true),
  (204, 'Davi Dias', 'davi@estudante.test', 'aluno', true),
  (205, 'Eva Esteves', 'eva@estudante.test', 'aluno', true),
  (206, 'Fábio Fontes', 'fabio@estudante.test', 'aluno', true);
SELECT setval(pg_get_serial_sequence('usuarios', 'id'), 1000);
INSERT INTO professores (usuario_id, cargo, aprovado, papel_servidor, papel_orientador, papel_supervisor, empresa_externa, funcao_externa) VALUES
  (10, 'admin', true, false, false, false, NULL, NULL),
  (11, 'comum', true, true, false, false, NULL, NULL),
  (12, 'comum', true, false, true, true, NULL, NULL),
  (13, 'comum', true, false, true, true, NULL, NULL),
  (14, 'supervisor', true, false, false, true, 'Agro Vale', 'Gerente'),
  (15, 'supervisor', false, false, false, true, 'Cooper Sul', 'Técnico'),
  (16, 'comum', true, false, true, true, NULL, NULL),
  (17, 'comum', true, false, true, true, NULL, NULL);
INSERT INTO alunos (usuario_id, matricula, curso, empresa, status, supervisor_id, orientador_id, carga_horaria, arquivado, encerrado_em) VALUES
  (201, '2024001', '${CURSO}', 'Agro Vale', 'em_andamento', 13, 12, 100, false, NULL),
  (202, '2024002', '${CURSO}', 'Agro Vale', 'concluido', 14, 12, 4, false, NULL),
  (203, NULL, '${CURSO}', NULL, 'lista_espera', NULL, NULL, 60, false, NULL),
  (204, '2024004', '${CURSO}', 'Agro Vale', 'concluido', 13, 12, 4, false, NOW()),
  (205, '2024005', '${CURSO}', 'Agro Vale', 'em_andamento', 13, 12, 60, true, NULL);
INSERT INTO atividades (aluno_id, data, hora_inicio, hora_fim, horas, descricao, status_validacao, avaliado_por) VALUES
  (202, '2026-10-05', '08:00', '12:00', 4, 'Manejo do pomar', 'validada', 14),
  (204, '2026-10-06', '08:00', '12:00', 4, 'Inventário do estoque', 'validada', 13);
`;

async function criarAmbiente({ antesDasRotas } = {}) {
    const db = await criarBanco();
    ligarPool(db);
    if (antesDasRotas) await antesDasRotas();

    const sessoes = new Map();
    function sessaoDe(chave, usuarioId) {
        if (!sessoes.has(chave)) {
            const sessao = {
                save(callback) { callback && callback(); },
                destroy(callback) { sessoes.delete(chave); for (const k of Object.keys(sessao)) if (typeof sessao[k] !== 'function') delete sessao[k]; callback && callback(); },
                regenerate(callback) { for (const k of Object.keys(sessao)) if (typeof sessao[k] !== 'function') delete sessao[k]; callback && callback(); },
            };
            if (usuarioId) sessao.user = { id: usuarioId };
            sessoes.set(chave, sessao);
        }
        return sessoes.get(chave);
    }

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(RAIZ, 'src/views'));
    app.locals.icone = require('../../src/utils/icones').icone;
    app.locals.dataIso = require('../../src/utils/datas').dataParaInput;
    app.locals.dataBr = require('../../src/utils/datas').formatarDataBr;
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(require('../../src/middleware/seguranca').normalizarCorpo);
    app.use((req, res, next) => {
        const usuarioId = req.headers['x-usuario'] ? Number(req.headers['x-usuario']) : null;
        const chave = req.headers['x-sessao'] || (usuarioId ? `u${usuarioId}` : `anon-${Math.random()}`);
        req.session = sessaoDe(chave, usuarioId);
        next();
    });
    app.use(require('../../src/middleware/auth').attachUser);
    app.use('/', require('../../src/routes/index'));
    app.use('/', require('../../src/routes/auth'));
    app.use('/acesso', require('../../src/routes/acesso'));
    app.use('/supervisor', require('../../src/routes/supervisor'));
    app.use('/auth/dev', require('../../src/routes/dev-login'));
    app.use('/aluno', require('../../src/routes/aluno'));
    app.use('/professor', require('../../src/routes/professor'));
    app.use((req, res) => res.status(404).render('404'));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => res.status(500).send(`erro: ${err.message}`));

    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;

    // como: id da pessoa (sessão "u<id>"); sessao: chave explícita da sessão
    async function pedir(rota, { como, sessao, corpo, metodo } = {}) {
        const headers = {};
        if (como) headers['x-usuario'] = String(como);
        if (sessao) headers['x-sessao'] = sessao;
        if (corpo) headers['content-type'] = 'application/x-www-form-urlencoded';
        const resposta = await fetch(url + rota, {
            method: metodo || (corpo ? 'POST' : 'GET'),
            redirect: 'manual',
            headers,
            body: corpo ? new URLSearchParams(corpo) : undefined,
        });
        resposta.local = resposta.headers.get('location');
        return resposta;
    }

    // Lê e consome a mensagem deixada para a próxima tela.
    function flash(chave) {
        const sessao = sessoes.get(typeof chave === 'number' ? `u${chave}` : chave);
        const mensagem = sessao && sessao.flash;
        if (sessao) delete sessao.flash;
        return mensagem || null;
    }

    async function sql(texto, params) {
        const { rows } = await db.query(texto, params);
        return rows;
    }

    async function semear() {
        sessoes.clear();
        await db.exec(SEMENTE);
    }

    async function fechar() {
        await new Promise((resolve) => server.close(resolve));
        await db.close();
        await pool.end();
    }

    return { db, url, pedir, flash, sql, semear, fechar, sessoes };
}

module.exports = { criarAmbiente, criarBanco, ligarPool, PESSOAS, CURSO, SEMENTE };
