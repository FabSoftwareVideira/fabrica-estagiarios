ALTER TABLE atividades
    ADD COLUMN IF NOT EXISTS status_validacao VARCHAR(20) NOT NULL DEFAULT 'pendente',
    ADD COLUMN IF NOT EXISTS avaliado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS avaliado_em TIMESTAMP;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'atividades'
          AND column_name = 'validado'
    ) THEN
        UPDATE atividades
        SET status_validacao = CASE WHEN validado THEN 'validada' ELSE 'pendente' END,
            avaliado_por = validado_por,
            avaliado_em = validado_em;

        ALTER TABLE atividades DROP COLUMN validado;
        ALTER TABLE atividades DROP COLUMN validado_por;
        ALTER TABLE atividades DROP COLUMN validado_em;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'atividades_status_validacao_check'
    ) THEN
        ALTER TABLE atividades
            ADD CONSTRAINT atividades_status_validacao_check
            CHECK (status_validacao IN ('pendente', 'validada', 'invalidada'));
    END IF;
END $$;
