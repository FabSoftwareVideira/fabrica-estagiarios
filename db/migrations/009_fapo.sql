CREATE TABLE IF NOT EXISTS fapos (
    aluno_id        INTEGER PRIMARY KEY REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    nota            NUMERIC(4,1) NOT NULL CHECK (nota >= 0 AND nota <= 10),
    comentarios     TEXT NOT NULL DEFAULT '',
    data_assinatura DATE NOT NULL,
    criado_em       TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);
