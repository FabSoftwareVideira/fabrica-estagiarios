const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool } = require('./config/database');
const { attachUser } = require('./middleware/auth');

const app = express();

const isProd = process.env.APP_ENV === 'production';

// necessário pra cookie "secure" funcionar corretamente atrás de um reverse
// proxy (nginx/traefik) que faz o TLS termination em produção
if (isProd) {
    app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Sessão persistida no Postgres (mesmo banco da aplicação) em vez do
// MemoryStore padrão do express-session. O MemoryStore some a cada restart
// do container/processo — e como o login com GitHub depende da sessão
// sobreviver entre "/auth/github" (onde o "state" é salvo) e
// "/auth/github/callback" (onde ele é conferido), qualquer restart/deploy
// bem no meio desse intervalo derruba o "state" e a autenticação falha com
// "tente novamente" — o que casa com o comportamento relatado (falha na
// primeira tentativa, funciona ao tentar de novo).
app.use(session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'dev-secret-troque-em-producao',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 8, // 8h
        sameSite: 'lax',
        secure: isProd,
    },
}));

app.use(attachUser);

// Routes
app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/aluno', require('./routes/aluno'));
app.use('/professor', require('./routes/professor'));

// Health check
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'ok',
            version: process.env.APP_VERSION || 'dev',
            env: process.env.APP_ENV || 'development',
            db: 'connected',
        });
    } catch {
        res.status(503).json({ status: 'error', db: 'disconnected' });
    }
});

// 404 - sempre por último
app.use((req, res) => {
    res.status(404).render('404');
});

// Handler de erro genérico (mantém a etapa "sem se preocupar com segurança",
// mas evita que o processo caia e ao menos loga o problema no console)
app.use((err, req, res, next) => {
    console.error('[app] erro não tratado:', err);
    res.status(500).send('Ocorreu um erro inesperado. Tente novamente.');
});

module.exports = app;
