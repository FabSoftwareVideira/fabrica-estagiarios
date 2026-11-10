-- Novo papel "servidor": pessoas do setor de estágios do campus (@ifc.edu.br)
-- que não são professores. Acompanham todos os estagiários, mas não orientam,
-- não supervisionam e não participam de bancas.
ALTER TABLE professores
    DROP CONSTRAINT IF EXISTS professores_cargo_check;

ALTER TABLE professores
    ADD CONSTRAINT professores_cargo_check
        CHECK (cargo IN ('comum', 'admin', 'supervisor', 'servidor'));
