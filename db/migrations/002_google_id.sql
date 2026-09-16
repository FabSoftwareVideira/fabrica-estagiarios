-- Migration: adiciona o identificador único das contas Google.

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;