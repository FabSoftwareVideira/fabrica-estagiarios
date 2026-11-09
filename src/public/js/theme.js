// Executado no <head>, antes do CSS, para evitar um flash do tema incorreto.
(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const chave = 'tema';
    const valido = (valor) => valor === 'light' || valor === 'dark';
    let escolha = null;
    try {
        const salva = localStorage.getItem(chave);
        if (valido(salva)) escolha = salva;
        if (localStorage.getItem('contraste') === '1') root.classList.add('alto-contraste');
    } catch { /* O tema continua funcionando quando o armazenamento está bloqueado. */ }

    function aplicar() {
        const tema = escolha || (media.matches ? 'dark' : 'light');
        root.dataset.theme = tema;
        document.querySelectorAll('[data-theme-toggle]').forEach((botao) => {
            const rotulo = tema === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro';
            botao.setAttribute('aria-label', rotulo);
            botao.setAttribute('title', rotulo);
            botao.setAttribute('aria-pressed', String(tema === 'dark'));
        });
    }
    aplicar();
    media.addEventListener('change', () => { if (!escolha) aplicar(); });
    window.addEventListener('storage', (evento) => {
        if (evento.key !== chave && evento.key !== null) return;
        escolha = valido(evento.newValue) ? evento.newValue : null;
        aplicar();
    });
    document.addEventListener('DOMContentLoaded', () => {
        aplicar();
        document.querySelectorAll('[data-theme-toggle]').forEach((botao) => {
            botao.addEventListener('click', () => {
                escolha = root.dataset.theme === 'dark' ? 'light' : 'dark';
                try { localStorage.setItem(chave, escolha); } catch { /* Preferência nesta página. */ }
                aplicar();
            });
        });
    });
})();
