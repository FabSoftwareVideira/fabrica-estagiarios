CREATE TABLE IF NOT EXISTS usuarios (
    id            SERIAL PRIMARY KEY,
    nome          VARCHAR(150) NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    github_id     BIGINT UNIQUE,
    avatar_url    TEXT,
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
    criado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alunos (
    usuario_id      INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    matricula       VARCHAR(30) NOT NULL UNIQUE,
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
    horas       NUMERIC(5,2) NOT NULL CHECK (horas > 0),
    descricao   TEXT NOT NULL,
    criado_em   TIMESTAMP NOT NULL DEFAULT NOW()
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
