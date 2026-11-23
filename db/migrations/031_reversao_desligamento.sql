ALTER TABLE desligamentos ADD COLUMN IF NOT EXISTS horario_trabalho_anterior JSONB;
ALTER TABLE desligamentos ADD COLUMN IF NOT EXISTS revertido_em TIMESTAMP;
ALTER TABLE desligamentos ADD COLUMN IF NOT EXISTS revertido_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
