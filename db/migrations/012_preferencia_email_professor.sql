-- Permite que cada professor controle o recebimento dos resumos semanais.
ALTER TABLE professores
    ADD COLUMN IF NOT EXISTS receber_relatorio_semanal BOOLEAN NOT NULL DEFAULT true;
