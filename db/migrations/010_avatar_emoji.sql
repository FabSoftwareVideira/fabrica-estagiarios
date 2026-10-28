-- Adiciona avatar selecionável pelos alunos.
-- Em bancos existentes, aplique com:
-- docker exec -i fabrica-estagiarios-db psql -U <POSTGRES_USER> -d <POSTGRES_DB> < db/migrations/010_avatar_emoji.sql

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS avatar_emoji TEXT;
