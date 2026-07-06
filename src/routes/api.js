const router = require('express').Router();
const { pool } = require('../config/database');

router.get('/hello', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() AS time');
        res.json({
            message: 'Olá, Mundo!',
            db_time: result.rows[0].time,
            version: process.env.APP_VERSION || 'dev',
        });
    } catch (err) {
        res.status(503).json({ error: 'db unavailable', detail: err.message });
    }
});

module.exports = router;