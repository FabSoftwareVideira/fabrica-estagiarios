-- Migração pra quem já tem o banco rodando em produção com o schema antigo
-- (login local com senha). Rode isso UMA VEZ contra o Postgres de produção,
-- via docker compose exec, antes de subir a versão nova da aplicação.
--
-- Exemplo:
--   docker compose -f docker-compose.prod.yml exec -T estagiarios-db \
--     psql -U appuser -d estagiarios-db < db/migration_github_oauth.sql

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS github_id BIGINT UNIQUE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE usuarios ALTER COLUMN senha_hash DROP NOT NULL;

ALTER TABLE professores DROP COLUMN IF EXISTS confirmado;

INSERT INTO usuarios (nome, email, tipo) VALUES
    ('Fabricio Bizotto', 'fabricio.bizotto@ifc.edu.br', 'professor')
ON CONFLICT (email) DO NOTHING;

INSERT INTO professores (usuario_id, cargo)
SELECT id, 'admin' FROM usuarios WHERE email = 'fabricio.bizotto@ifc.edu.br'
ON CONFLICT (usuario_id) DO NOTHING;

-- Depois de confirmar que todo mundo já logou pelo menos uma vez via GitHub
-- e a coluna senha_hash não é mais usada em lugar nenhum, você pode rodar
-- (opcional, não é necessário pra app funcionar):
-- ALTER TABLE usuarios DROP COLUMN senha_hash;
