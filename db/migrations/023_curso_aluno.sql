ALTER TABLE alunos
    ADD COLUMN IF NOT EXISTS curso VARCHAR(150);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'alunos_curso_check'
          AND conrelid = 'public.alunos'::regclass
    ) THEN
        ALTER TABLE alunos
            ADD CONSTRAINT alunos_curso_check CHECK (curso IN (
                'Curso Técnico de Agropecuária Integrado ao Ensino Médio',
                'Curso Técnico em Eletroeletrônica Integrado ao Ensino Médio',
                'Curso Técnico em Informática Integrado ao Ensino Médio'
            ));
    END IF;
END
$$;
