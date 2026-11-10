-- Rascunhos do fluxo "Incluir estágio" do setor de estágios. Os dados do
-- formulário ficam em JSON até a inclusão ser concluída; qualquer pessoa do
-- setor pode continuar um rascunho iniciado por outra.
CREATE TABLE IF NOT EXISTS estagios_rascunhos (
    id            SERIAL PRIMARY KEY,
    dados         JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_por    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em     TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
