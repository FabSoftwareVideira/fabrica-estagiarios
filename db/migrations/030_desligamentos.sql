CREATE TABLE IF NOT EXISTS desligamentos (
    id SERIAL PRIMARY KEY,
    aluno_id INTEGER NOT NULL REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    supervisor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    supervisor_nome TEXT NOT NULL,
    empresa TEXT NOT NULL,
    desligado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    desligado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    solicitado_em TIMESTAMP,
    confirmado_em TIMESTAMP,
    confirmado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    fichas_anteriores JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE alunos ADD COLUMN IF NOT EXISTS versao_estagio INTEGER NOT NULL DEFAULT 0;
ALTER TABLE atividades ADD COLUMN IF NOT EXISTS desligamento_id INTEGER REFERENCES desligamentos(id);
ALTER TABLE atividades ADD COLUMN IF NOT EXISTS contabilizar BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_desligamentos_aluno ON desligamentos(aluno_id);
CREATE INDEX IF NOT EXISTS idx_atividades_desligamento ON atividades(desligamento_id);
