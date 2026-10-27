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
