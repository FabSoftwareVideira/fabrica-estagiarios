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

    document.querySelectorAll('[data-dashboard-tabs]').forEach((tabContainer) => {
        const tabs = Array.from(tabContainer.querySelectorAll('[role="tab"]'));

        const ativarAba = (abaAtiva, moverFoco = false) => {
            tabs.forEach((tab) => {
                const ativa = tab === abaAtiva;
                tab.setAttribute('aria-selected', String(ativa));
                tab.tabIndex = ativa ? 0 : -1;
                tab.classList.toggle('is-active', ativa);

                const painel = document.getElementById(tab.getAttribute('aria-controls'));
                if (painel) painel.hidden = !ativa;
            });

            if (moverFoco) abaAtiva.focus();
        };

        tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => ativarAba(tab));
            tab.addEventListener('keydown', (event) => {
                let proximoIndice;
                if (event.key === 'ArrowRight') proximoIndice = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') proximoIndice = (index - 1 + tabs.length) % tabs.length;
                else if (event.key === 'Home') proximoIndice = 0;
                else if (event.key === 'End') proximoIndice = tabs.length - 1;
                else return;

                event.preventDefault();
                ativarAba(tabs[proximoIndice], true);
            });
        });

        const selecionada = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
        if (selecionada) ativarAba(selecionada);
    });

    const horaInicio = document.getElementById('hora_inicio');
    const horaFim = document.getElementById('hora_fim');
    const horasCalculadas = document.getElementById('horas');

    if (horaInicio && horaFim && horasCalculadas) {
        const minutosDoDia = (valor) => {
            const correspondencia = valor.match(/^(\d{2}):(\d{2})$/);
            if (!correspondencia) return null;
            return Number(correspondencia[1]) * 60 + Number(correspondencia[2]);
        };

        const calcularHoras = () => {
            horaFim.setCustomValidity('');
            horasCalculadas.value = '';
            if (!horaInicio.value || !horaFim.value) return;

            const inicio = minutosDoDia(horaInicio.value);
            const fim = minutosDoDia(horaFim.value);
            if (inicio === null || fim === null || fim <= inicio) {
                horaFim.setCustomValidity('O horário final deve ser posterior ao horário inicial.');
                return;
            }

            const duracaoMinutos = fim - inicio;
            if (duracaoMinutos > 6 * 60) {
                horaFim.setCustomValidity('Cada atividade pode ter no máximo 6 horas.');
                return;
            }

            horasCalculadas.value = (duracaoMinutos / 60).toFixed(2);
        };

        horaInicio.addEventListener('input', calcularHoras);
        horaFim.addEventListener('input', calcularHoras);
        horaInicio.addEventListener('change', calcularHoras);
        horaFim.addEventListener('change', calcularHoras);
        calcularHoras();
    }

    const descricaoAtividade = document.getElementById('descricao');
    const contadorDescricao = document.getElementById('descricao-contador');
    if (descricaoAtividade && contadorDescricao) {
        const atualizarContador = () => {
            contadorDescricao.textContent = `${descricaoAtividade.value.length}/140 caracteres`;
        };
        descricaoAtividade.addEventListener('input', atualizarContador);
        atualizarContador();
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
