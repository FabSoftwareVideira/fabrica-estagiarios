-- Uma pessoa interna (@ifc.edu.br) pode acumular papéis: administrador,
-- servidor do setor de estágios, orientador e supervisor.
--   administrador  continua em professores.cargo = 'admin'
--   servidor       papel_servidor   (vê todos os estágios e o acompanhamento)
--   orientador     papel_orientador (pode orientar e avaliar bancas)
--   supervisor     papel_supervisor (pode supervisionar estudantes)
-- O supervisor externo continua sendo cargo = 'supervisor' e ignora essas colunas.
ALTER TABLE professores
    ADD COLUMN IF NOT EXISTS papel_servidor BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS papel_orientador BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS papel_supervisor BOOLEAN NOT NULL DEFAULT true;

-- Quem já era servidor (cargo exclusivo da migração 026) vira conta interna
-- só com o papel de servidor.
UPDATE professores
SET cargo = 'comum', papel_servidor = true, papel_orientador = false, papel_supervisor = false
WHERE cargo = 'servidor';
