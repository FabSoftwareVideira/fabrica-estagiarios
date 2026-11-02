-- Garante o campo de encerramento mesmo em bancos cujo histórico já registrou
-- a migração 014, mas cujo schema foi restaurado sem essa coluna.
ALTER TABLE alunos
    ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMP;
