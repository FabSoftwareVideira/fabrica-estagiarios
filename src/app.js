const express = require('express');
const path = require('path');
const { pool } = require('./config/database');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', require('./routes/index'));
app.use('/api', require('./routes/api'));

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

module.exports = app;