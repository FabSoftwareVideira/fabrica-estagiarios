-- Migration: validação das horas registradas pelos alunos.
--
-- Cada atividade passa a ter uma validação feita pelo professor. Somente as
-- horas de atividades validadas contam para a conclusão do estágio.
--
-- Em bancos já existentes, rode uma vez:
--
--   docker exec -i fabrica-estagiarios-db psql -U <POSTGRES_USER> -d <POSTGRES_DB> < db/migrations/004_validacao_atividades.sql
--
-- As atividades antigas ficam como pendentes (validado = false) e precisam
-- ser validadas pelo professor. Como consequência, alunos marcados como
-- "concluido" sem horas validadas voltam para "em_andamento".

ALTER TABLE atividades
    ADD COLUMN IF NOT EXISTS validado BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS validado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS validado_em TIMESTAMP;

UPDATE alunos a
SET status = 'em_andamento'
WHERE a.status = 'concluido'
  AND COALESCE((
      SELECT SUM(horas) FROM atividades
      WHERE aluno_id = a.usuario_id AND validado
  ), 0) < a.carga_horaria;
