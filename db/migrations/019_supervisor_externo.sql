ALTER TABLE professores
    DROP CONSTRAINT IF EXISTS professores_cargo_check;

ALTER TABLE professores
    ADD CONSTRAINT professores_cargo_check
        CHECK (cargo IN ('comum', 'admin', 'supervisor'));

ALTER TABLE professores
    ADD COLUMN IF NOT EXISTS aprovado BOOLEAN NOT NULL DEFAULT true;
