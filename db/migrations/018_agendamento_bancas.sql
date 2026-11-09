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
