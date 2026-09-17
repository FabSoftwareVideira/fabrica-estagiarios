-- Migration: permite cadastrar alunos sem matrícula.

ALTER TABLE alunos
    ALTER COLUMN matricula DROP NOT NULL;