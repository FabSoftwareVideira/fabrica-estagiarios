// ─── main.js ──────────────────────────────────────────────────────────────
// Comportamento global do front-end (menu mobile e interações das telas).

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

    // impede supervisor e orientador de serem o mesmo professor
    // (checagem "de verdade" fica no servidor, isso aqui é só feedback rápido)
    const supervisorSelect = document.getElementById('supervisor');
    const orientadorSelect = document.getElementById('orientador');

    if (supervisorSelect && orientadorSelect) {
        const form = supervisorSelect.closest('form');

        const validarMesmoProfessor = () => {
            const mesmo = supervisorSelect.value && supervisorSelect.value === orientadorSelect.value;
            orientadorSelect.setCustomValidity(mesmo ? 'Supervisor e orientador não podem ser o mesmo professor.' : '');
            return !mesmo;
        };

        supervisorSelect.addEventListener('change', validarMesmoProfessor);
        orientadorSelect.addEventListener('change', validarMesmoProfessor);

        if (form) {
            form.addEventListener('submit', (e) => {
                // botões secundários (ex.: "Arquivar") não devem ser bloqueados por essa checagem
                const submitter = e.submitter;
                if (submitter && submitter.formNoValidate) return;

                if (!validarMesmoProfessor()) {
                    e.preventDefault();
                    orientadorSelect.reportValidity();
                }
            });
        }
    }

    // filtros em formato de botão (checkbox) aplicam na hora
    document.querySelectorAll('[data-auto-submit]').forEach((input) => {
        input.addEventListener('change', () => {
            if (input.form) input.form.requestSubmit();
        });
    });

    // preenche a barra de progresso de acordo com o percentual
    document.querySelectorAll('.progress-bar[data-percent]').forEach((bar) => {
        bar.style.width = `${bar.dataset.percent}%`;
    });

    // calcula a nota final da FAA enquanto o aluno preenche as notas
    const notasFaa = document.querySelectorAll('[data-faa-nota]');
    const mediaFaa = document.getElementById('faa-media');

    if (notasFaa.length > 0 && mediaFaa) {
        const atualizarMedia = () => {
            const soma = Array.from(notasFaa).reduce((total, input) => {
                const nota = Number(input.value);
                return total + (Number.isFinite(nota) ? nota : 0);
            }, 0);
            mediaFaa.textContent = (soma / notasFaa.length).toFixed(2).replace('.', ',');
        };

        notasFaa.forEach((input) => input.addEventListener('input', atualizarMedia));
        atualizarMedia();
    }
});
