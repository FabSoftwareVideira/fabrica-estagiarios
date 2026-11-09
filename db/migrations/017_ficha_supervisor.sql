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
