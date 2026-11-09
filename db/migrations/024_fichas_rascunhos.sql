CREATE TABLE IF NOT EXISTS fichas_rascunhos (
    aluno_id      INTEGER NOT NULL REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('FAA', 'FAPO', 'FAC')),
    dados         JSONB NOT NULL CHECK (jsonb_typeof(dados) = 'object'),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (aluno_id, tipo)
);
