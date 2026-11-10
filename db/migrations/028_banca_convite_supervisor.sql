-- O orientador pode convidar o supervisor do estagiário para a banca.
-- O supervisor recebe o convite, mas não é avaliador.
ALTER TABLE bancas
    ADD COLUMN IF NOT EXISTS convidar_supervisor BOOLEAN NOT NULL DEFAULT false;
