ALTER TABLE alunos
    ADD COLUMN IF NOT EXISTS horario_trabalho JSONB NOT NULL DEFAULT '{}'::jsonb;
