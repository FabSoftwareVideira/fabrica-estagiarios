CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email_lower_unique
    ON usuarios (LOWER(email));
