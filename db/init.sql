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
    orientador_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    enviado_em    TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (semana_inicio, orientador_id)
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
