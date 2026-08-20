-- Migration: adiciona a coluna "nome_confirmado" em usuarios.
--
-- init.sql só roda automaticamente em bancos NOVOS (volume vazio). No banco
-- de produção já existente, rode este arquivo manualmente uma vez, do mesmo
-- jeito que foi feito pra inicializar o schema originalmente:
--
--   docker exec -i fabrica-estagiarios-db psql -U <POSTGRES_USER> -d <POSTGRES_DB> < db/migrations/001_nome_confirmado.sql
--
-- Todo usuário já existente fica com nome_confirmado = false (valor padrão
-- da coluna), então alunos e professores que já tinham conta vão ver a
-- telinha de confirmar nome completo no próximo login — isso é esperado,
-- é justamente o que resolve nomes incompletos vindos do GitHub (ex.: "willi").

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS nome_confirmado BOOLEAN NOT NULL DEFAULT false;
