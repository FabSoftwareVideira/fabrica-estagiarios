// ─── main.js ──────────────────────────────────────────────────────────────
// Comportamento global do front-end (menu mobile, marcação de link ativo).

document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.querySelector('.main-nav');

    if (toggle && nav) {
        toggle.addEventListener('click', () => {
            const isOpen = nav.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(isOpen));
        });

        // fecha o menu ao clicar em um link (útil no mobile)
        nav.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                nav.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

    // marca o link ativo no menu com base na URL atual
    document.querySelectorAll('.main-nav a').forEach((link) => {
        if (link.getAttribute('href') === window.location.pathname) {
            link.classList.add('active');
        }
    });

    // anima a barra de progresso (evita ela já nascer preenchida sem transição)
    document.querySelectorAll('.progress-bar[data-percent]').forEach((bar) => {
        const percent = bar.dataset.percent;
        requestAnimationFrame(() => {
            bar.style.width = `${percent}%`;
        });
    });
});
