// Demonstração local explícita: banco em memória e e-mails capturados.
// Não é importada pelo servidor da aplicação nem utiliza o PostgreSQL/SMTP real.
if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('A demonstração só pode ser iniciada em ambiente de desenvolvimento.');
}
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const { PGlite } = require('@electric-sql/pglite');
const { pool } = require('../config/database');
const { executar } = require('./enviarLembretesAtividades');
const { gerarFacPdf } = require('../services/facPdf');
const { agoraBrasilia } = require('../utils/bancas');

async function iniciar() {
    const db = new PGlite();
    await db.exec(fs.readFileSync(path.join(__dirname, '../../db/init.sql'), 'utf8'));
    await db.exec(`INSERT INTO usuarios (id,nome,email,tipo,nome_confirmado) VALUES
        (101,'Carlos Andrade','carlos@example.test','professor',true),
        (102,'Marina Lopes','marina@example.test','professor',true),
        (103,'Rafael Costa','rafael@example.test','professor',true),
        (104,'Extensão • Demonstração','extensao@example.test','professor',true),
        (105,'Luiza Ribeiro','luiza@example.test','professor',true),
        (201,'Ana Souza','ana@example.test','aluno',true),
        (202,'Bruno Lima','bruno@example.test','aluno',true),
        (203,'Carla Santos','carla@example.test','aluno',true),
        (204,'Diego Alves','diego@example.test','aluno',true);
        INSERT INTO professores (usuario_id,cargo) VALUES (101,'comum'),(102,'comum'),(103,'comum'),(104,'admin'),(105,'comum');
        INSERT INTO alunos (usuario_id,matricula,empresa,status,supervisor_id,orientador_id,carga_horaria)
        VALUES (201,'2026001','Tecnologia Exemplo','concluido',102,101,60),
        (202,'2026002','Sistemas Exemplo','concluido',102,101,60),
        (203,'2026003','Oficina Exemplo','em_andamento',102,101,60),
        (204,'2026004','Laboratório Exemplo','em_andamento',102,101,60);
        INSERT INTO atividades (aluno_id,data,hora_inicio,hora_fim,horas,descricao,status_validacao)
        SELECT aluno, CURRENT_DATE - (20 + dia), '08:00', '14:00', 6, 'Desenvolvimento e testes de sistemas.', 'validada'
        FROM (VALUES (201),(202)) a(aluno) CROSS JOIN generate_series(1,10) dia;
        INSERT INTO atividades (aluno_id,data,hora_inicio,hora_fim,horas,descricao,status_validacao,criado_em)
        VALUES (203,CURRENT_DATE - 6,'08:00','12:00',4,'Organização de documentos.','validada',NOW()-INTERVAL '6 days'),
        (204,CURRENT_DATE - 1,'08:00','12:00',4,'Atendimento e documentação.','pendente',NOW()-INTERVAL '1 day');
        UPDATE alunos SET relatorio_atualizado_em=NOW()-INTERVAL '6 days' WHERE usuario_id=203;
        INSERT INTO fapos (aluno_id,nota,comentarios,data_assinatura) VALUES (201,9,'Bom desenvolvimento ao longo do estágio.',CURRENT_DATE);`);
    const query = async (sql, params) => {
        if (/pg_(try_advisory_lock|advisory_unlock)/.test(sql)) return { rows: [{ adquirido: true }], rowCount: 1 };
        const r = await db.query(sql, params);
        // Reproduz o comportamento de DATE do driver pg (meia-noite local).
        for (const campo of r.fields.filter((f) => f.dataTypeID === 1082)) {
            for (const row of r.rows) {
                const data = row[campo.name];
                if (data instanceof Date) row[campo.name] = new Date(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
            }
        }
        return { ...r, rowCount: r.affectedRows ?? r.rows.length };
    };
    pool.query = query;
    let fila = Promise.resolve();
    pool.connect = async () => {
        const anterior = fila; let liberar; fila = new Promise((r) => { liberar = r; }); await anterior;
        return { query, release: liberar };
    };
    const app = express();
    app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '../views'));
    app.locals.icone = require('../utils/icones').icone;
    app.locals.dataBr = require('../utils/datas').formatarDataBr;
    app.locals.dataIso = require('../utils/datas').dataParaInput;
    app.locals.demoMode = true;
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, '../public')));
    app.use(session({ secret: require('crypto').randomBytes(32).toString('hex'), resave: false, saveUninitialized: false, cookie: { sameSite: 'strict', httpOnly: true } }));
    const perfis = { orientador: 101, supervisor: 102, admin: 104, ana: 201, bruno: 202, carla: 203 };
    app.post('/demo/entrar/:perfil', async (req, res) => {
        const id = perfis[req.params.perfil]; if (!id) return res.sendStatus(404);
        const { rows } = await query('SELECT u.*,p.cargo FROM usuarios u LEFT JOIN professores p ON p.usuario_id=u.id WHERE u.id=$1', [id]);
        const u = rows[0]; req.session.user = { id: u.id, nome: u.nome, email: u.email, tipo: u.tipo, cargo: u.cargo };
        res.redirect(u.tipo === 'aluno' ? '/aluno/dashboard' : req.params.perfil === 'supervisor' ? '/professor/fichas' : '/professor/bancas');
    });
    app.use(require('../middleware/auth').attachUser);
    const mensagens = [];
    let resultado = null;
    const port = Number(process.env.DEMO_PORT || 3001);
    // avisos de banca também caem na caixa local da demonstração
    const capturaBancas = nodemailer.createTransport({ jsonTransport: true });
    require('../services/conviteBanca').usarConfiguracaoEmail(() => ({ remetente: 'estagios@example.test',
        enderecoRemetente: 'estagios@example.test', urlAplicacao: `http://127.0.0.1:${port}`,
        transporte: { async sendMail(mail) {
            const info = await capturaBancas.sendMail(mail); mensagens.push(JSON.parse(info.message)); return info;
        } } }));
    app.get('/demo', async (req, res) => {
        const { rows: alunos } = await query(`SELECT u.nome,a.status,
            FLOOR(EXTRACT(EPOCH FROM (NOW()-a.relatorio_atualizado_em))/86400)::int AS dias,
            l.enviado_em, l.proximo_envio_em FROM alunos a JOIN usuarios u ON u.id=a.usuario_id
            LEFT JOIN lembretes_atividades l ON l.aluno_id=a.usuario_id ORDER BY u.nome`);
        res.render('demo', { mensagens, resultado, alunos, hoje: agoraBrasilia().data });
    });
    app.post('/demo/lembretes', async (req, res) => {
        const transporte = nodemailer.createTransport({ jsonTransport: true });
        resultado = await executar({ configurarEmail: () => ({ remetente: 'estagios@example.test', urlAplicacao: `http://127.0.0.1:${port}`,
            transporte: { async sendMail(mail) {
                const info = await transporte.sendMail(mail); mensagens.push(JSON.parse(info.message)); return info;
            } } }) });
        res.redirect('/demo');
    });
    app.get('/demo/emails/:id', (req, res) => {
        const mensagem = mensagens[Number(req.params.id)]; if (!mensagem) return res.sendStatus(404);
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
        res.send(mensagem.html);
    });
    app.get('/demo/fac/:id/visualizar', async (req, res) => {
        const aluno = await require('../models/alunos').buscarPorUsuarioId(req.params.id);
        const fac = await require('../models/facs').buscarPorAluno(req.params.id);
        if (!aluno || !fac) return res.status(404).send('Salve a FAC antes de visualizar.');
        res.type('pdf').set('Content-Disposition', 'inline; filename="FAC-demonstracao.pdf"').send(Buffer.from(await gerarFacPdf({ aluno, fac })));
    });
    app.get('/demo/saude', (req, res) => res.json({ ok: true, demonstracao: true }));
    app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/demo')));
    app.get('/login', (req, res) => res.redirect('/demo'));
    app.use('/', require('../routes/index'));
    app.use('/professor', require('../routes/professor'));
    app.use('/aluno', require('../routes/aluno'));
    app.use((err, req, res, next) => { console.error(err); res.status(500).send('Erro na demonstração: ' + err.message); });
    const server = app.listen(port, '127.0.0.1', () => console.log(`Demonstração: http://127.0.0.1:${port}/demo — dados fictícios em memória; nenhum e-mail externo.`));
    const parar = () => server.close(async () => { await db.close(); await pool.end(); process.exit(0); });
    process.on('SIGINT', parar); process.on('SIGTERM', parar);
}
iniciar().catch((e) => { console.error(e); process.exitCode = 1; });
