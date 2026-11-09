CREATE TABLE IF NOT EXISTS usuarios (
    id            SERIAL PRIMARY KEY,
    nome          VARCHAR(150) NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    github_id     BIGINT UNIQUE,
    google_id     VARCHAR(255) UNIQUE,
    avatar_url    TEXT,
    avatar_emoji  TEXT,
    tipo          VARCHAR(20)  NOT NULL CHECK (tipo IN ('aluno', 'professor')),
    -- o GitHub só garante o "login"/nome público no OAuth, então o nome pode
    -- vir incompleto (ex.: só o primeiro nome); esse campo controla se a
    -- pessoa já passou pela telinha de confirmar/editar o nome completo
    nome_confirmado BOOLEAN    NOT NULL DEFAULT false,
    criado_em     TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS professores (
    usuario_id  INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    cargo       VARCHAR(20) NOT NULL DEFAULT 'comum' CHECK (cargo IN ('comum', 'admin')),
    receber_relatorio_semanal BOOLEAN NOT NULL DEFAULT true,
    criado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alunos (
    usuario_id      INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    matricula       VARCHAR(30) UNIQUE,
    empresa         TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'lista_espera'
                        CHECK (status IN ('lista_espera', 'em_andamento', 'concluido')),
    supervisor_id   INTEGER REFERENCES usuarios(id),
    orientador_id   INTEGER REFERENCES usuarios(id),
    carga_horaria   INTEGER NOT NULL DEFAULT 60,
    arquivado       BOOLEAN NOT NULL DEFAULT false,
    encerrado_em    TIMESTAMP,
    criado_em       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS atividades (
    id          SERIAL PRIMARY KEY,
    aluno_id    INTEGER NOT NULL REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    data        DATE NOT NULL,
    hora_inicio TIME,
    hora_fim    TIME,
    horas       NUMERIC(5,2) NOT NULL CHECK (horas > 0),
    descricao   TEXT NOT NULL,
    status_validacao VARCHAR(20) NOT NULL DEFAULT 'pendente'
                     CHECK (status_validacao IN ('pendente', 'validada', 'invalidada')),
    avaliado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    avaliado_em TIMESTAMP,
    criado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS faas (
    aluno_id        INTEGER PRIMARY KEY REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    empresa         TEXT NOT NULL,
    periodo         TEXT NOT NULL,
    notas           JSONB NOT NULL CHECK (jsonb_typeof(notas) = 'array' AND jsonb_array_length(notas) = 10),
    atividades      TEXT NOT NULL,
    respostas       JSONB NOT NULL CHECK (jsonb_typeof(respostas) = 'array' AND jsonb_array_length(respostas) = 7),
    comentarios     TEXT NOT NULL DEFAULT '',
    data_assinatura DATE NOT NULL,
    criado_em       TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fapos (
    aluno_id        INTEGER PRIMARY KEY REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    nota            NUMERIC(4,1) NOT NULL CHECK (nota >= 0 AND nota <= 10),
    comentarios     TEXT NOT NULL DEFAULT '',
    data_assinatura DATE NOT NULL,
    criado_em       TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fares (
    aluno_id            INTEGER PRIMARY KEY REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    periodo             TEXT NOT NULL DEFAULT '',
    -- nota da FAC (avaliação do concedente), digitada pelo orientador
    nota_fac            NUMERIC(4,1) CHECK (nota_fac IS NULL OR (nota_fac >= 0 AND nota_fac <= 10)),
    -- só é usada quando o aluno não preencheu a FAA no sistema
    nota_faa_manual     NUMERIC(4,1) CHECK (nota_faa_manual IS NULL OR (nota_faa_manual >= 0 AND nota_faa_manual <= 10)),
    -- 3 critérios (apresentação, prática, relatório) x 3 notas (N1, N2, N3)
    banca               JSONB NOT NULL DEFAULT '[[null,null,null],[null,null,null],[null,null,null]]'
                            CHECK (jsonb_typeof(banca) = 'array' AND jsonb_array_length(banca) = 3),
    avaliador_1         TEXT NOT NULL DEFAULT '',
    avaliador_2         TEXT NOT NULL DEFAULT '',
    resultado           VARCHAR(20) CHECK (resultado IS NULL OR resultado IN ('aprovado', 'aprovado_ressalva', 'reprovado')),
    corrigir_relatorio_ate     DATE,
    refazer_apresentacao_ate   DATE,
    comentarios         TEXT NOT NULL DEFAULT '',
    data_ata            DATE,
    criado_em           TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS configuracoes_relatorio_semanal (
    id                  SMALLINT PRIMARY KEY CHECK (id = 1),
    habilitado          BOOLEAN NOT NULL DEFAULT false,
    dia_semana          SMALLINT NOT NULL DEFAULT 5 CHECK (dia_semana BETWEEN 0 AND 6),
    horario             TIME NOT NULL DEFAULT '18:00',
    ultimo_envio_semana DATE,
    atualizado_em       TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO configuracoes_relatorio_semanal (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS envios_relatorios_semanais (
    semana_inicio DATE NOT NULL,
    supervisor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    enviado_em    TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (semana_inicio, supervisor_id)
);

CREATE INDEX IF NOT EXISTS idx_atividades_aluno ON atividades(aluno_id);
CREATE INDEX IF NOT EXISTS idx_alunos_status ON alunos(status);
CREATE INDEX IF NOT EXISTS idx_alunos_arquivado ON alunos(arquivado);

-- Admin principal: cadastro é criado sem github_id (é preenchido
-- automaticamente no primeiro login dele via GitHub, casando pelo e-mail).
-- Essa conta nunca pode ser excluída pelo painel (ver src/routes/professor.js).
INSERT INTO usuarios (nome, email, tipo) VALUES
    ('Fabricio Bizotto', 'fabricio.bizotto@ifc.edu.br', 'professor')
ON CONFLICT (email) DO NOTHING;

INSERT INTO professores (usuario_id, cargo)
SELECT id, 'admin' FROM usuarios WHERE email = 'fabricio.bizotto@ifc.edu.br'
ON CONFLICT (usuario_id) DO NOTHING;

-- Lembretes e ficha de avaliação do supervisor.
-- O relógio do relatório mede a ação do estudante, não a data da atividade
-- nem a validação feita pelo supervisor.
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS relatorio_atualizado_em TIMESTAMP;
UPDATE alunos a SET relatorio_atualizado_em = GREATEST(a.criado_em,
    (SELECT MAX(criado_em) FROM atividades WHERE aluno_id = a.usuario_id))
WHERE relatorio_atualizado_em IS NULL;
ALTER TABLE alunos ALTER COLUMN relatorio_atualizado_em SET DEFAULT NOW();
ALTER TABLE alunos ALTER COLUMN relatorio_atualizado_em SET NOT NULL;

CREATE OR REPLACE FUNCTION registrar_atualizacao_relatorio() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE alunos SET relatorio_atualizado_em = NOW() WHERE usuario_id = NEW.aluno_id;
    ELSIF (NEW.data, NEW.hora_inicio, NEW.hora_fim, NEW.horas, NEW.descricao)
        IS DISTINCT FROM (OLD.data, OLD.hora_inicio, OLD.hora_fim, OLD.horas, OLD.descricao) THEN
        UPDATE alunos SET relatorio_atualizado_em = NOW() WHERE usuario_id = NEW.aluno_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS atividades_atualizam_relatorio ON atividades;
CREATE TRIGGER atividades_atualizam_relatorio AFTER INSERT OR UPDATE ON atividades
FOR EACH ROW EXECUTE FUNCTION registrar_atualizacao_relatorio();

CREATE OR REPLACE FUNCTION iniciar_prazo_relatorio() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'em_andamento' AND
       (OLD.status = 'lista_espera' OR (OLD.arquivado AND NOT NEW.arquivado)) THEN
        NEW.relatorio_atualizado_em = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS alunos_iniciam_prazo_relatorio ON alunos;
CREATE TRIGGER alunos_iniciam_prazo_relatorio BEFORE UPDATE ON alunos
FOR EACH ROW EXECUTE FUNCTION iniciar_prazo_relatorio();

CREATE TABLE IF NOT EXISTS lembretes_atividades (
    aluno_id INTEGER PRIMARY KEY REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    enviado_em TIMESTAMP,
    proximo_envio_em TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS facs (
    aluno_id INTEGER PRIMARY KEY REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    supervisor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    supervisor_nome TEXT NOT NULL,
    empresa TEXT NOT NULL,
    curso TEXT NOT NULL,
    periodo TEXT NOT NULL,
    notas JSONB NOT NULL CHECK (jsonb_typeof(notas) = 'array' AND jsonb_array_length(notas) = 10),
    atividades TEXT NOT NULL,
    comentarios TEXT NOT NULL DEFAULT '',
    local_assinatura TEXT NOT NULL,
    data_assinatura DATE NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Agenda de bancas
CREATE TABLE IF NOT EXISTS bancas (
    aluno_id INTEGER PRIMARY KEY REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    orientador_id INTEGER NOT NULL REFERENCES usuarios(id),
    avaliador_1_id INTEGER NOT NULL REFERENCES usuarios(id),
    avaliador_2_id INTEGER NOT NULL REFERENCES usuarios(id),
    data DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL,
    sala VARCHAR(120) NOT NULL CHECK (length(trim(sala)) > 0),
    link_reuniao TEXT NOT NULL DEFAULT '',
    observacoes VARCHAR(1000) NOT NULL DEFAULT '',
    situacao VARCHAR(20) NOT NULL DEFAULT 'agendada'
        CHECK (situacao IN ('agendada', 'remarcada', 'cancelada', 'realizada')),
    versao INTEGER NOT NULL DEFAULT 1,
    atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (hora_fim > hora_inicio),
    CHECK (orientador_id <> avaliador_1_id AND orientador_id <> avaliador_2_id
        AND avaliador_1_id <> avaliador_2_id)
);
CREATE INDEX IF NOT EXISTS idx_bancas_data ON bancas(data, hora_inicio);
