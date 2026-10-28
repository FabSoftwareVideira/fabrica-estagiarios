-- O envio e o controle semanal passam a ser direcionados ao supervisor.
DO $$
BEGIN
    IF to_regclass('envios_relatorios_semanais') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'envios_relatorios_semanais'
             AND column_name = 'orientador_id'
       )
       AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'envios_relatorios_semanais'
             AND column_name = 'supervisor_id'
       ) THEN
        ALTER TABLE envios_relatorios_semanais
            RENAME COLUMN orientador_id TO supervisor_id;
    END IF;
END $$;
