const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`[server] running on port ${PORT}`);
    console.log(`[server] env: ${process.env.APP_ENV || 'development'}`);
    console.log(`[server] version: ${process.env.APP_VERSION || 'dev'}`);
});