ALTER TABLE professores
    ADD COLUMN IF NOT EXISTS empresa_externa TEXT,
    ADD COLUMN IF NOT EXISTS funcao_externa TEXT;
