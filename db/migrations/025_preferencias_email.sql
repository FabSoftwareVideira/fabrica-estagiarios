-- Cada pessoa escolhe, no perfil, quais e-mails da plataforma quer receber.
-- O resumo semanal dos professores continua em professores.receber_relatorio_semanal.
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS receber_email_bancas BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS receber_lembretes_atividades BOOLEAN NOT NULL DEFAULT true;
