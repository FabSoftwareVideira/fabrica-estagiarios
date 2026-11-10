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
    document.querySelectorAll('.progress-bar[data-percent], .progress-pending[data-percent]').forEach((bar) => {
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

// ─── Recursos novos: contraste, tabelas no celular, calendário e ata ─────────

document.addEventListener('DOMContentLoaded', () => {
    // alto contraste (lembra a escolha neste navegador)
    document.querySelectorAll('[data-contraste]').forEach((botao) => {
        const raiz = document.documentElement;
        botao.setAttribute('aria-pressed', String(raiz.classList.contains('alto-contraste')));
        botao.addEventListener('click', () => {
            const ligado = raiz.classList.toggle('alto-contraste');
            botao.setAttribute('aria-pressed', String(ligado));
            try { localStorage.setItem('contraste', ligado ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
        });
    });

    // no celular as tabelas viram cartões: cada célula ganha o título da coluna
    document.querySelectorAll('.table-wrap table').forEach((tabela) => {
        const titulos = Array.from(tabela.querySelectorAll('thead th')).map((th) => {
            const copia = th.cloneNode(true);
            copia.querySelectorAll('.sort-icon').forEach((icone) => icone.remove());
            return copia.textContent.trim();
        });
        tabela.querySelectorAll('tbody tr').forEach((linha) => {
            Array.from(linha.children).forEach((celula, i) => {
                if (!celula.hasAttribute('data-label') && titulos[i]) celula.setAttribute('data-label', titulos[i]);
            });
        });
    });

    // confirmação antes de ações importantes
    document.addEventListener('click', (evento) => {
        const alvo = evento.target.closest('[data-confirmar]');
        if (alvo && !window.confirm(alvo.dataset.confirmar)) evento.preventDefault();
    });

    document.querySelectorAll('[data-calendario]').forEach(iniciarCalendario);
    document.querySelectorAll('[data-ata]').forEach(iniciarAta);
    document.querySelectorAll('[data-wizard]').forEach(iniciarWizard);
});

function formatarNumero(valor, casas = 2) {
    if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
    return Number(valor).toFixed(casas).replace('.', ',');
}

function iniciarCalendario(el) {
    const dados = JSON.parse(el.querySelector('[data-cal-dados]').textContent || '[]');
    const horariosTrabalho = JSON.parse(el.querySelector('[data-cal-horarios]').textContent || '{}');
    const modo = el.dataset.modo;
    const hoje = el.dataset.hoje;
    const podeRegistrar = el.dataset.podeRegistrar === '1';
    const grade = el.querySelector('[data-cal-grade]');
    const titulo = el.querySelector('[data-cal-titulo]');
    const contexto = el.closest('section, .card') || document;
    const painel = contexto.querySelector('[data-cal-painel]');
    const campoData = modo === 'selecionar' ? document.getElementById('data') : null;
    const linhasTabela = document.querySelectorAll('tr[data-dia]');
    const avisoFiltro = document.querySelector('[data-cal-filtro]');

    const porDia = new Map();
    dados.forEach((a) => {
        const dia = porDia.get(a.data) || { horas: 0, itens: [], validada: false, invalidada: false };
        dia.horas += a.horas;
        dia.itens.push(a);
        if (a.status === 'validada') dia.validada = true;
        if (a.status === 'invalidada') dia.invalidada = true;
        porDia.set(a.data, dia);
    });

    const iso = (ano, mes, dia) => `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const dataDe = (texto) => { const [a, m, d] = texto.split('-').map(Number); return new Date(a, m - 1, d); };
    const ehDomingo = (data) => data.getDay() === 0;
    const formatarHoras = (h) => String(Number(h.toFixed(2))).replace('.', ',');

    let selecionado = el.dataset.selecionado || (campoData && campoData.value) || '';
    const base = dataDe(selecionado || hoje);
    let visivel = { ano: base.getFullYear(), mes: base.getMonth() };

    function atualizarPainel() {
        if (!painel) return;
        painel.replaceChildren();
        if (!selecionado) { painel.hidden = true; return; }

        const data = dataDe(selecionado);
        const dia = porDia.get(selecionado);
        const nome = data.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

        const linha = document.createElement('p');
        const forte = document.createElement('strong');
        forte.textContent = nome;
        linha.append(forte);

        const domingo = ehDomingo(data);
        const horarioPlanejado = horariosTrabalho[String(data.getDay())];
        const horas = dia ? dia.horas : 0;
        const restam = Math.max(0, 6 - horas);
        if (domingo) {
            linha.append(' — domingo: não dá para registrar horas.');
        } else if (!dia) {
            linha.append(' — nenhuma atividade ainda. Você pode registrar até 6h.');
        } else if (restam === 0) {
            linha.append(` — ${formatarHoras(horas)}h registradas. O limite de 6h do dia foi atingido.`);
        } else {
            linha.append(` — ${formatarHoras(horas)}h registradas, restam ${formatarHoras(restam)}h.`);
        }
        if (horarioPlanejado) {
            linha.append(` Horário planejado: ${horarioPlanejado.inicio}–${horarioPlanejado.fim}.`);
        } else if (!domingo && Object.keys(horariosTrabalho).length > 0) {
            linha.append(' Este dia não está na escala planejada; ainda assim, o registro é permitido.');
        }
        painel.append(linha);

        if (dia) {
            const lista = document.createElement('ul');
            lista.className = 'dia-lista';
            dia.itens.forEach((a) => {
                const item = document.createElement('li');
                const hora = document.createElement('time');
                hora.textContent = a.inicio && a.fim ? `${a.inicio}–${a.fim}` : `${formatarHoras(a.horas)}h`;
                const texto = document.createElement('span');
                const rotulo = { validada: 'validada', pendente: 'aguardando validação', invalidada: 'invalidada' }[a.status] || '';
                texto.textContent = `${a.descricao} (${rotulo})`;
                item.append(hora, texto);
                lista.append(item);
            });
            painel.append(lista);
        }

        if (modo === 'ver' && podeRegistrar && !domingo && restam > 0) {
            const link = document.createElement('a');
            link.href = `/aluno/nova-atividade?data=${selecionado}`;
            link.className = 'btn btn-success btn-sm';
            link.style.marginTop = '10px';
            link.textContent = 'Registrar atividade neste dia';
            painel.append(link);
        }
        painel.hidden = false;
    }

    function filtrarTabela() {
        if (modo !== 'ver') return;
        linhasTabela.forEach((linha) => { linha.hidden = Boolean(selecionado) && linha.dataset.dia !== selecionado; });
        if (avisoFiltro) avisoFiltro.hidden = !selecionado;
    }

    function selecionar(valor) {
        selecionado = valor;
        if (campoData && campoData.value !== valor) {
            campoData.value = valor;
            campoData.dispatchEvent(new Event('change', { bubbles: true }));
        }
        desenhar();
        atualizarPainel();
        filtrarTabela();
    }

    function desenhar() {
        const { ano, mes } = visivel;
        titulo.textContent = new Date(ano, mes, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        grade.replaceChildren();

        ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach((letra, i) => {
            const cab = document.createElement('div');
            cab.className = `cal-semana${i === 0 || i === 6 ? ' fim' : ''}`;
            cab.textContent = letra;
            cab.setAttribute('aria-hidden', 'true');
            grade.append(cab);
        });

        const primeiro = new Date(ano, mes, 1).getDay();
        for (let i = 0; i < primeiro; i += 1) {
            const vazio = document.createElement('span');
            vazio.className = 'cal-dia fora';
            grade.append(vazio);
        }

        const totalDias = new Date(ano, mes + 1, 0).getDate();
        for (let d = 1; d <= totalDias; d += 1) {
            const chave = iso(ano, mes, d);
            const data = new Date(ano, mes, d);
            const dia = porDia.get(chave);
            const domingo = ehDomingo(data);
            const horarioPlanejado = horariosTrabalho[String(data.getDay())];

            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'cal-dia';
            if (domingo) botao.classList.add('fim-semana');
            if (horarioPlanejado) botao.classList.add('dia-planejado');
            if (chave === hoje) botao.classList.add('hoje');
            if (chave === selecionado) botao.classList.add('selecionado');
            if (dia && dia.validada) botao.classList.add('tem-validada');
            if (dia && dia.invalidada) botao.classList.add('tem-invalidada');
            if (dia && dia.horas >= 6) botao.classList.add('lotado');

            const numero = document.createElement('span');
            numero.textContent = String(d);
            botao.append(numero);
            if (dia) {
                const chip = document.createElement('span');
                chip.className = 'cal-horas';
                chip.textContent = `${formatarHoras(dia.horas)}h`;
                botao.append(chip);
            }

            const longa = data.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
            const escala = horarioPlanejado ? `, horário planejado ${horarioPlanejado.inicio} às ${horarioPlanejado.fim}` : '';
            botao.title = horarioPlanejado ? `Horário planejado: ${horarioPlanejado.inicio}–${horarioPlanejado.fim}` : '';
            botao.setAttribute('aria-label', `${longa}${dia ? `, ${formatarHoras(dia.horas)} horas registradas` : ''}${escala}${domingo ? ', domingo, não permite registro' : ''}`);
            botao.setAttribute('aria-pressed', String(chave === selecionado));

            if (domingo && modo === 'selecionar') {
                botao.setAttribute('aria-disabled', 'true');
            } else {
                botao.addEventListener('click', () => {
                    selecionar(modo === 'ver' && chave === selecionado ? '' : chave);
                });
            }
            grade.append(botao);
        }
    }

    el.querySelectorAll('[data-cal]').forEach((botao) => {
        botao.addEventListener('click', () => {
            const acao = botao.dataset.cal;
            if (acao === 'hoje') {
                const h = dataDe(hoje);
                visivel = { ano: h.getFullYear(), mes: h.getMonth() };
            } else {
                const novo = new Date(visivel.ano, visivel.mes + (acao === 'proximo' ? 1 : -1), 1);
                visivel = { ano: novo.getFullYear(), mes: novo.getMonth() };
            }
            desenhar();
        });
    });

    // digitar a data no campo também atualiza o calendário
    if (campoData) {
        campoData.addEventListener('change', () => {
            if (campoData.value && campoData.value !== selecionado) {
                selecionado = campoData.value;
                const nova = dataDe(selecionado);
                visivel = { ano: nova.getFullYear(), mes: nova.getMonth() };
                desenhar();
                atualizarPainel();
            }
        });
    }

    const limpar = document.querySelector('[data-cal-limpar]');
    if (limpar) limpar.addEventListener('click', () => selecionar(''));

    desenhar();
    atualizarPainel();
    filtrarTabela();
}

function iniciarAta(form) {
    const SOMA_PESOS = 10;
    const ler = (valor) => {
        const n = parseFloat(String(valor).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    };

    const calcular = () => {
        const pontos = {};

        form.querySelectorAll('[data-ata-nota]').forEach((campo) => {
            const nota = ler(campo.value);
            pontos[campo.dataset.ataNota] = nota === null ? null : (nota * Number(campo.dataset.peso)) / SOMA_PESOS;
        });
        form.querySelectorAll('[data-ata-fixa]').forEach((item) => {
            const nota = ler(item.dataset.valor);
            pontos[item.dataset.ataFixa] = nota === null ? null : (nota * Number(item.dataset.peso)) / SOMA_PESOS;
        });
        form.querySelectorAll('[data-ata-banca]').forEach((linha) => {
            const notas = Array.from(linha.querySelectorAll('[data-banca]')).map((c) => ler(c.value)).filter((n) => n !== null);
            const media = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null;
            linha.querySelector('[data-media]').textContent = formatarNumero(media);
            pontos[linha.dataset.chave] = media === null ? null : (media * Number(linha.dataset.peso)) / SOMA_PESOS;
        });

        let final = 0;
        Object.entries(pontos).forEach(([chave, valor]) => {
            if (valor !== null) final += valor;
            document.querySelectorAll(`[data-pt="${chave}"]`).forEach((c) => { c.textContent = formatarNumero(valor); });
        });
        const textoFinal = formatarNumero(Math.round((final + Number.EPSILON) * 100) / 100);
        document.querySelectorAll('[data-ata-final]').forEach((c) => { c.textContent = textoFinal; });
    };

    form.addEventListener('input', calcular);

    const ressalva = form.querySelector('[data-ressalva]');
    form.querySelectorAll('input[name="resultado"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            if (ressalva) ressalva.hidden = form.querySelector('input[name="resultado"]:checked').value !== 'aprovado_ressalva';
        });
    });

    // escolher uma data de ressalva marca a opção correspondente
    ['corrigir_relatorio', 'refazer_apresentacao'].forEach((nome) => {
        const caixa = form.querySelector(`input[name="${nome}"]`);
        const data = form.querySelector(`input[name="${nome}_ate"]`);
        if (caixa && data) {
            data.addEventListener('input', () => { if (data.value) caixa.checked = true; });
        }
    });

    calcular();
}

// ─── Aprovação em etapas (primeira aprovação do estudante) ──────────────────
// Um único formulário dividido em passos; sem JavaScript todos os passos
// aparecem juntos e o envio funciona igual.
function iniciarWizard(form) {
    const passos = Array.from(form.querySelectorAll('[data-passo]'));
    const etapas = form.querySelector('[data-wizard-etapas]');
    const erro = form.querySelector('[data-wizard-erro]');
    const voltar = form.querySelector('[data-wizard-voltar]');
    const avancar = form.querySelector('[data-wizard-avancar]');
    const enviar = form.querySelector('[data-wizard-enviar]');
    const resumo = form.querySelector('[data-wizard-resumo]');
    if (passos.length < 2 || !etapas || !voltar || !avancar || !enviar) return;

    let atual = 0;
    form.noValidate = true; // a validação é feita passo a passo
    form.classList.add('wizard-ativo');
    passos.forEach((passo) => { passo.hidden = false; });
    etapas.hidden = false;

    const marcadores = passos.map((passo, indice) => {
        const item = document.createElement('li');
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'wizard-etapa';
        const numero = document.createElement('span');
        numero.className = 'wizard-etapa-numero';
        numero.textContent = String(indice + 1);
        const nome = document.createElement('span');
        nome.className = 'wizard-etapa-nome';
        nome.textContent = passo.dataset.titulo || `Passo ${indice + 1}`;
        botao.append(numero, nome);
        // só dá para voltar a passos já visitados; avançar exige validar
        botao.addEventListener('click', () => { if (indice < atual) mostrar(indice); });
        item.append(botao);
        etapas.append(item);
        return botao;
    });

    const mostrarErro = (mensagem) => {
        if (!erro) return;
        erro.textContent = mensagem || '';
        erro.hidden = !mensagem;
    };

    const minutos = (valor) => Number(valor.slice(0, 2)) * 60 + Number(valor.slice(3));

    // mesmas regras do servidor, para o erro aparecer no passo certo
    function validarHorarios(passo) {
        const dias = Array.from(passo.querySelectorAll('input[name="dias_trabalho"]:checked'));
        if (dias.length === 0) return 'Selecione ao menos um dia de trabalho.';
        for (const dia of dias) {
            const inicio = form.querySelector(`[name="horario_inicio_${dia.value}"]`).value;
            const fim = form.querySelector(`[name="horario_fim_${dia.value}"]`).value;
            if (!inicio || !fim) return 'Informe entrada e saída para cada dia selecionado.';
            const duracao = minutos(fim) - minutos(inicio);
            if (duracao <= 0) return 'O horário de saída deve ser posterior ao de entrada.';
            if (duracao > 6 * 60) return 'A jornada planejada não pode ultrapassar 6 horas por dia.';
        }
        return '';
    }

    // devolve a mensagem de erro do passo ('' quando está tudo certo)
    function validar(indice) {
        const passo = passos[indice];
        const invalido = Array.from(passo.querySelectorAll('input, select, textarea')).find((campo) => !campo.checkValidity());
        if (invalido) {
            mostrarErro('');
            invalido.reportValidity();
            return false;
        }
        let mensagem = '';
        const orientador = form.querySelector('[name="orientador_id"]');
        const supervisor = form.querySelector('[name="supervisor_id"]');
        if (supervisor && passo.contains(supervisor) && supervisor.value && orientador && supervisor.value === orientador.value) {
            mensagem = 'Supervisor e orientador não podem ser a mesma pessoa.';
        }
        if (!mensagem && passo.hasAttribute('data-passo-horarios')) mensagem = validarHorarios(passo);
        mostrarErro(mensagem);
        return !mensagem;
    }

    function linhaResumo(rotulo, valor) {
        const bloco = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = rotulo;
        const dd = document.createElement('dd');
        dd.textContent = valor;
        bloco.append(dt, dd);
        return bloco;
    }

    function montarResumo() {
        if (!resumo) return;
        resumo.replaceChildren();
        form.querySelectorAll('[data-resumo]').forEach((campo) => {
            let valor = campo.tagName === 'SELECT'
                ? (campo.value ? campo.options[campo.selectedIndex].textContent.trim() : '')
                : campo.value.trim();
            if (valor && campo.dataset.resumoSufixo) valor += campo.dataset.resumoSufixo;
            resumo.append(linhaResumo(campo.dataset.resumo, valor || campo.dataset.resumoVazio || '—'));
        });
        const horarios = linhaResumo('Dias e horários', '');
        horarios.classList.add('wizard-resumo-horarios');
        const dd = horarios.querySelector('dd');
        form.querySelectorAll('input[name="dias_trabalho"]:checked').forEach((dia) => {
            const inicio = form.querySelector(`[name="horario_inicio_${dia.value}"]`).value;
            const fim = form.querySelector(`[name="horario_fim_${dia.value}"]`).value;
            const linha = document.createElement('span');
            linha.textContent = `${dia.closest('label').textContent.trim()}, ${inicio}–${fim}`;
            dd.append(linha);
        });
        resumo.append(horarios);
    }

    function mostrar(indice, focar = true) {
        atual = indice;
        mostrarErro('');
        const ultimo = atual === passos.length - 1;
        if (ultimo) montarResumo();
        passos.forEach((passo, i) => passo.classList.toggle('wizard-atual', i === atual));
        marcadores.forEach((botao, i) => {
            botao.classList.toggle('atual', i === atual);
            botao.classList.toggle('feito', i < atual);
            botao.disabled = i > atual;
            if (i === atual) botao.setAttribute('aria-current', 'step');
            else botao.removeAttribute('aria-current');
        });
        voltar.hidden = atual === 0;
        avancar.hidden = ultimo;
        enviar.hidden = !ultimo;
        if (focar) {
            const titulo = passos[atual].querySelector('h2, legend');
            if (titulo) {
                titulo.tabIndex = -1;
                titulo.focus({ preventScroll: true });
            }
            form.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    }

    avancar.addEventListener('click', () => { if (validar(atual)) mostrar(atual + 1); });
    voltar.addEventListener('click', () => mostrar(atual - 1));

    // Enter num campo avança o passo em vez de enviar o formulário incompleto
    form.addEventListener('submit', (evento) => {
        if (atual < passos.length - 1) {
            evento.preventDefault();
            if (validar(atual)) mostrar(atual + 1);
            return;
        }
        for (let i = 0; i < passos.length - 1; i += 1) {
            if (!validar(i)) {
                evento.preventDefault();
                mostrar(i);
                validar(i);
                return;
            }
        }
    });

    // preencher um horário marca o dia correspondente
    form.querySelectorAll('.horario-trabalho-dia').forEach((dia) => {
        const caixa = dia.querySelector('input[name="dias_trabalho"]');
        dia.querySelectorAll('input[type="time"]').forEach((campo) => {
            campo.addEventListener('input', () => { if (campo.value && caixa) caixa.checked = true; });
        });
    });

    mostrar(0, false);
}
