// Executado no <head>, antes do CSS, para evitar um flash sem o alto contraste escolhido.
(() => {
    try {
        if (localStorage.getItem('contraste') === '1') document.documentElement.classList.add('alto-contraste');
    } catch { /* A página continua funcionando quando o armazenamento está bloqueado. */ }
})();
