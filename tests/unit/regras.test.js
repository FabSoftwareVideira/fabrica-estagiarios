// Testes unitários das regras puras: datas, horário de trabalho, cálculo da
// ata, papéis, situação do estágio, FAC e configuração de e-mail.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const datas = require('../../src/utils/datas');
const { validarHorarioTrabalho, DIAS_TRABALHO } = require('../../src/utils/horarioTrabalho');
const ata = require('../../src/utils/ata');
const papeis = require('../../src/config/papeis');
const { estagioStatus, etapaAtual, ETAPAS } = require('../../src/config/status');
const { lerFac, mediaFac, CRITERIOS_FAC } = require('../../src/utils/fac');
const { obterConfiguracaoEmail, escaparHtml } = require('../../src/services/email');
const { dadosParaPdf } = require('../../src/services/ataDados');

describe('datas', () => {
    test('dataLocalIso usa o calendário local', () => {
        assert.equal(datas.dataLocalIso(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    });

    test('dataIsoValida recusa formatos e dias inexistentes', () => {
        assert.equal(datas.dataIsoValida('2024-02-29'), true);
        for (const valor of ['2026-02-29', '2026-13-01', '2026-1-01', '01/02/2026', '', null, 20260101]) {
            assert.equal(datas.dataIsoValida(valor), false, String(valor));
        }
    });

    test('dataParaInput aceita texto, Date e timestamp', () => {
        assert.equal(datas.dataParaInput('2026-03-04T10:00:00Z'), '2026-03-04');
        assert.equal(datas.dataParaInput(new Date(2026, 2, 4)), '2026-03-04');
        assert.equal(datas.dataParaInput(new Date(2026, 2, 4).getTime()), '2026-03-04');
        assert.equal(datas.dataParaInput(new Date('inválida')), '');
        assert.equal(datas.dataParaInput(null), '');
    });

    test('formatarDataBr e formatarHora', () => {
        assert.equal(datas.formatarDataBr('2026-03-04'), '04/03/2026');
        assert.equal(datas.formatarDataBr(''), '');
        assert.equal(datas.formatarHora('08:30:00'), '08:30');
        assert.equal(datas.formatarHora(null), '');
    });

    test('nomeParaArquivo tira acentos e símbolos', () => {
        assert.equal(datas.nomeParaArquivo('  João da Conceição / 2º ano '), 'Joao-da-Conceicao-2-ano');
        assert.equal(datas.nomeParaArquivo('***'), 'aluno');
        assert.equal(datas.nomeParaArquivo(null, 'ficha'), 'ficha');
    });

    test('periodoDasAtividades considera só as validadas', () => {
        const lista = [
            { data: '2026-05-10', status_validacao: 'validada' },
            { data: '2026-03-01', status_validacao: 'pendente' },
            { data: new Date(2026, 3, 2), status_validacao: 'validada' },
            { data: null, status_validacao: 'validada' },
        ];
        assert.equal(datas.periodoDasAtividades(lista), '02/04/2026 a 10/05/2026');
        assert.equal(datas.periodoDasAtividades([]), '');
        assert.equal(datas.periodoDasAtividades(undefined), '');
    });
});

describe('horário de trabalho', () => {
    const corpo = { horario_inicio_1: '08:00', horario_fim_1: '12:00', horario_inicio_3: '13:00', horario_fim_3: '17:30' };

    test('aceita um dia ou vários, sem repetir', () => {
        assert.deepEqual(validarHorarioTrabalho('1', corpo), { horarioTrabalho: { 1: { inicio: '08:00', fim: '12:00' } } });
        assert.deepEqual(Object.keys(validarHorarioTrabalho(['1', '3', '1'], corpo).horarioTrabalho), ['1', '3']);
        assert.equal(DIAS_TRABALHO.length, 6);
    });

    test('recusa dia inválido, horário ausente, invertido ou acima de 6 horas', () => {
        assert.match(validarHorarioTrabalho([], corpo).erro, /ao menos um dia/);
        assert.match(validarHorarioTrabalho(['7'], corpo).erro, /ao menos um dia/);
        assert.match(validarHorarioTrabalho(['2'], corpo).erro, /entrada e saída/);
        assert.match(validarHorarioTrabalho(['1'], { horario_inicio_1: '8:00', horario_fim_1: '12:00' }).erro, /entrada e saída/);
        assert.match(validarHorarioTrabalho(['1'], { horario_inicio_1: '12:00', horario_fim_1: '12:00' }).erro, /posterior/);
        assert.match(validarHorarioTrabalho(['1'], { horario_inicio_1: '07:00', horario_fim_1: '13:01' }).erro, /6 horas/);
    });
});

describe('cálculo da ata (FARE)', () => {
    test('nota final é a soma ponderada dividida por 10', () => {
        const r = ata.calcularAta({ fac: 8, fapo: 9, faa: 10, banca: [[7, 8, 9], [10, 10, 10], [6, 6, 6]] });
        // 8*2 + 9*2 + 10*1 + 8*2 + 10*2 + 6*1 = 86 → 8,6
        assert.equal(r.final, 8.6);
        assert.deepEqual(r.mediasBanca, [8, 10, 6]);
        assert.equal(r.linhas.apresentacao.pontos, 1.6);
    });

    test('notas ausentes não contam, e média ignora campos vazios', () => {
        const r = ata.calcularAta({ fac: '', fapo: null, faa: undefined, banca: [[10, '', null], [], undefined] });
        assert.equal(r.final, 2);
        assert.equal(r.linhas.fac.nota, null);
        assert.equal(r.linhas.pratica.nota, null);
        assert.equal(ata.calcularAta({}).final, 0);
    });

    test('auxiliares de nota', () => {
        assert.equal(ata.media(['', 'x', 4, '6']), 5);
        assert.equal(ata.media([]), null);
        assert.equal(ata.notaDaFaa({ notas: [10, 8] }), 9);
        assert.equal(ata.notaDaFaa({ notas: [] }), null);
        assert.equal(ata.notaDaFaa(null), null);
        assert.equal(ata.formatarNotaBr(8.25, 2), '8,25');
        assert.equal(ata.formatarNotaBr(''), '');
        assert.equal(ata.arredondar(1.005), 1.01);
        assert.equal(ata.ehNumero('0'), true);
        assert.equal(ata.ehNumero(Infinity), false);
    });

    test('dados do PDF da ata: FAC atual enquanto o estágio não foi encerrado', () => {
        const aluno = { nome: 'Ana', empresa: 'Agro', horas_realizadas: '120.50', encerrado_em: null, orientador_nome: 'Olga' };
        const fare = { periodo: '', nota_fac: 5, nota_faa_manual: 7, banca: [[8, 8, 8], [8, 8, 8], [8, 8, 8]], resultado: 'aprovado' };
        const atividades = [{ data: '2026-05-10', status_validacao: 'validada' }];

        const d = dadosParaPdf({ aluno, fare, atividades, fac: { nota: 9 }, faa: null, fapo: { nota: 8 } });
        assert.equal(d.fac, 9);
        assert.equal(d.faa, 7);
        assert.equal(d.fapo, 8);
        assert.equal(d.horas, 120.5);
        assert.equal(d.periodo, '10/05/2026 a 10/05/2026');
        assert.equal(d.orientadorNome, 'Olga');

        const encerrado = dadosParaPdf({ aluno: { ...aluno, encerrado_em: new Date(), empresa: null }, fare, atividades, fac: { nota: 9 },
            faa: { notas: [10, 6] }, fapo: null, orientadorNome: 'Outro' });
        assert.equal(encerrado.fac, 5);
        assert.equal(encerrado.faa, 8);
        assert.equal(encerrado.fapo, null);
        assert.equal(encerrado.empresa, '');
        assert.equal(encerrado.orientadorNome, 'Outro');
    });
});

describe('papéis', () => {
    test('papeisDoPerfil: conta interna acumula papéis; supervisor externo é restrito', () => {
        assert.deepEqual(papeis.papeisDoPerfil({ cargo: 'admin', papel_servidor: true, papel_orientador: false, papel_supervisor: true }),
            { admin: true, servidor: true, orientador: false, supervisor: true, externo: false });
        assert.deepEqual(papeis.papeisDoPerfil({ cargo: 'supervisor', papel_servidor: true }),
            { admin: false, servidor: false, orientador: false, supervisor: true, externo: true });
        // colunas ausentes (antes da migração) mantêm orientador e supervisor ligados
        assert.deepEqual(papeis.papeisDoPerfil({ cargo: 'comum' }),
            { admin: false, servidor: false, orientador: true, supervisor: true, externo: false });
        assert.equal(papeis.papeisDoPerfil(null).admin, false);
        assert.deepEqual(papeis.CHAVES_PAPEIS, ['admin', 'servidor', 'orientador', 'supervisor']);
    });

    test('quem vê todos os estágios e quem tem estagiários próprios', () => {
        const so = (p, cargo = 'comum') => ({ cargo, papeis: { admin: false, servidor: false, orientador: false, supervisor: false, ...p } });
        assert.equal(papeis.veTodosOsEstagios(so({}, 'admin')), true);
        assert.equal(papeis.veTodosOsEstagios(so({ servidor: true })), true);
        assert.equal(papeis.veTodosOsEstagios(so({ orientador: true })), false);
        assert.equal(papeis.veTodosOsEstagios(null), false);
        assert.equal(papeis.temAlunosProprios(so({ supervisor: true })), true);
        assert.equal(papeis.temAlunosProprios(so({}, 'supervisor')), true);
        assert.equal(papeis.temAlunosProprios(so({ servidor: true })), false);
        assert.equal(papeis.temAlunosProprios({ cargo: 'comum' }), false);
    });

    test('tela inicial por papel', () => {
        const so = (p, cargo = 'comum') => ({ cargo, papeis: { ...p } });
        assert.equal(papeis.telaInicial(null), '/professor/dashboard');
        assert.equal(papeis.telaInicial(so({}, 'supervisor')), '/professor/dashboard');
        assert.equal(papeis.telaInicial(so({ servidor: true, orientador: true })), '/professor/acompanhamento');
        assert.equal(papeis.telaInicial(so({ orientador: true }, 'admin')), '/professor/dashboard');
        assert.equal(papeis.telaInicial(so({}, 'admin')), '/professor/administracao');
        assert.equal(papeis.telaInicial(so({})), '/professor/dashboard');
    });
});

describe('situação do estágio', () => {
    test('rótulo e etapa para cada situação', () => {
        const casos = [
            [null, 'indefinido', 0],
            [{ status: 'lista_espera' }, 'lista_espera', 0],
            [{ status: 'em_andamento' }, 'em_andamento', 1],
            [{ status: 'concluido', encerrado_em: null }, 'aguardando_banca', 2],
            [{ status: 'concluido', encerrado_em: new Date() }, 'encerrado', 3],
            [{ status: 'lista_espera', arquivado: true }, 'arquivado', 0],
        ];
        for (const [aluno, chave, etapa] of casos) {
            assert.equal(estagioStatus(aluno).chave, chave);
            assert.equal(etapaAtual(aluno), etapa, chave);
        }
        assert.equal(ETAPAS.length, 4);
    });
});

describe('FAC', () => {
    const CURSO = 'Curso Técnico em Informática Integrado ao Ensino Médio';
    const corpo = (extra = {}) => ({ empresa: 'Agro', periodo: '01/03 a 01/06', atividades: 'Pomar', comentarios: '',
        local_assinatura: 'Videira', data_assinatura: '2026-11-12',
        ...Object.fromEntries(CRITERIOS_FAC.map((_, i) => [`nota_${i}`, '8,25'])), ...extra });

    test('lê as notas com vírgula e calcula a média', () => {
        const { valores, erros } = lerFac(corpo(), CURSO);
        assert.deepEqual(erros, []);
        assert.equal(valores.notas[0], 8.25);
        // a média trabalha em décimos: cada nota é arredondada antes da soma
        assert.equal(mediaFac(valores.notas), 8.3);
        assert.equal(mediaFac([7, 8, 9, 10, 6, 7, 8, 9, 10, 6]), 8);
    });

    test('aponta curso ausente, campos longos, notas inválidas e data', () => {
        const { erros } = lerFac(corpo({ empresa: 'x'.repeat(61), nota_0: '10.5', nota_1: '7.333', nota_2: '', comentarios: 'y'.repeat(301), data_assinatura: '2026-02-30' }), '');
        assert.equal(erros.length, 7);
        assert.match(erros[0], /informar o curso/);
        assert.ok(erros.some((e) => /Empresa: preencha com até 60/.test(e)));
        assert.ok(erros.some((e) => /Comentários: use até 300/.test(e)));
        assert.ok(erros.some((e) => /data de assinatura/.test(e)));
    });
});

describe('matrícula', () => {
    const { lerMatricula } = require('../../src/utils/matricula');

    test('opcional: vazia vira null', () => {
        assert.deepEqual(lerMatricula(''), { valida: true, valor: null });
        assert.deepEqual(lerMatricula('   '), { valida: true, valor: null });
        assert.deepEqual(lerMatricula(undefined), { valida: true, valor: null });
    });

    test('só números, ignorando espaços', () => {
        assert.deepEqual(lerMatricula('2025008076'), { valida: true, valor: '2025008076' });
        assert.deepEqual(lerMatricula(' 2025 008 076 '), { valida: true, valor: '2025008076' });
        for (const invalida of ['TESTE0001', '2025-008076', '2025.008', '12a', '1'.repeat(21), '٣٤٥']) {
            assert.equal(lerMatricula(invalida).valida, false, invalida);
        }
    });
});

describe('configuração de e-mail', () => {
    const comAmbiente = (env, fn) => {
        const chaves = ['APP_ENV', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'APP_URL'];
        const anterior = Object.fromEntries(chaves.map((k) => [k, process.env[k]]));
        for (const k of chaves) { if (k in env) process.env[k] = env[k]; else delete process.env[k]; }
        try { return fn(); } finally {
            for (const k of chaves) { if (anterior[k] === undefined) delete process.env[k]; else process.env[k] = anterior[k]; }
        }
    };
    const base = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'estagios@example.test', SMTP_PASS: 'abcd efgh ijkl mnop', APP_URL: 'https://estagios.example.test/caminho' };

    test('produção exige SMTP autenticado e APP_URL válida', () => {
        assert.throws(() => comAmbiente({}, obterConfiguracaoEmail), /SMTP_HOST/);
        assert.throws(() => comAmbiente({ ...base, SMTP_PASS: '' }, obterConfiguracaoEmail), /SMTP_USER e SMTP_PASS/);
        assert.throws(() => comAmbiente({ ...base, APP_URL: '' }, obterConfiguracaoEmail), /Configure APP_URL/);
        assert.throws(() => comAmbiente({ ...base, APP_URL: 'não é url' }, obterConfiguracaoEmail), /URL válida/);
        assert.throws(() => comAmbiente({ ...base, APP_URL: 'ftp://exemplo' }, obterConfiguracaoEmail), /HTTP ou HTTPS/);
    });

    test('Gmail: espaços da senha de app são removidos; porta 465 usa TLS direto', () => {
        const c = comAmbiente({ ...base, SMTP_PORT: '465', SMTP_FROM: 'Estágios <estagios@example.test>' }, obterConfiguracaoEmail);
        assert.equal(c.urlAplicacao, 'https://estagios.example.test');
        assert.equal(c.remetente, 'Estágios <estagios@example.test>');
        assert.equal(c.transporte.options.auth.pass, 'abcdefghijklmnop');
        assert.equal(c.transporte.options.secure, true);
        assert.equal(c.transporte.options.port, 465);
    });

    test('desenvolvimento aceita SMTP sem autenticação (Mailpit)', () => {
        const c = comAmbiente({ APP_ENV: 'development', SMTP_HOST: 'mailpit', SMTP_PORT: '1025', APP_URL: 'http://localhost:3000' }, obterConfiguracaoEmail);
        assert.equal(c.transporte.options.auth, undefined);
        assert.equal(c.transporte.options.secure, false);
        assert.equal(c.remetente, '');
    });

    test('escaparHtml neutraliza marcação', () => {
        assert.equal(escaparHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
        assert.equal(escaparHtml(null), '');
    });
});
