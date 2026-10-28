-- Configuração única do envio semanal de relatórios aos orientadores.
CREATE TABLE IF NOT EXISTS configuracoes_relatorio_semanal (
    id                  SMALLINT PRIMARY KEY CHECK (id = 1),
    habilitado          BOOLEAN NOT NULL DEFAULT false,
    dia_semana          SMALLINT NOT NULL DEFAULT 5 CHECK (dia_semana BETWEEN 0 AND 6),
    horario             TIME NOT NULL DEFAULT '18:00',
    ultimo_envio_semana DATE,
    atualizado_em       TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO configuracoes_relatorio_semanal (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS envios_relatorios_semanais (
    semana_inicio DATE NOT NULL,
    orientador_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    enviado_em    TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (semana_inicio, orientador_id)
);
