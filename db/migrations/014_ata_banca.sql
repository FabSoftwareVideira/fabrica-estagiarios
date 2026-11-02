-- Migration: ata da banca (FARE) e encerramento do estágio.
--
-- * alunos.encerrado_em: preenchido quando o orientador conclui a ata da
--   banca. A partir daí o estágio fica somente leitura (só impressão).
-- * fares: dados da ata (nota do concedente, notas da banca, avaliadores,
--   resultado e comentários). As notas da FAPO e da FAA são lidas das
--   respectivas fichas na hora de calcular a nota final. Os campos são
--   opcionais para permitir salvar rascunho; a tela só deixa concluir
--   quando tudo estiver preenchido.

ALTER TABLE alunos
    ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMP;

CREATE TABLE IF NOT EXISTS fares (
    aluno_id            INTEGER PRIMARY KEY REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    periodo             TEXT NOT NULL DEFAULT '',
    -- nota da FAC (avaliação do concedente), digitada pelo orientador
    nota_fac            NUMERIC(4,1) CHECK (nota_fac IS NULL OR (nota_fac >= 0 AND nota_fac <= 10)),
    -- só é usada quando o aluno não preencheu a FAA no sistema
    nota_faa_manual     NUMERIC(4,1) CHECK (nota_faa_manual IS NULL OR (nota_faa_manual >= 0 AND nota_faa_manual <= 10)),
    -- 3 critérios (apresentação, prática, relatório) x 3 notas (N1, N2, N3)
    banca               JSONB NOT NULL DEFAULT '[[null,null,null],[null,null,null],[null,null,null]]'
                            CHECK (jsonb_typeof(banca) = 'array' AND jsonb_array_length(banca) = 3),
    avaliador_1         TEXT NOT NULL DEFAULT '',
    avaliador_2         TEXT NOT NULL DEFAULT '',
    resultado           VARCHAR(20) CHECK (resultado IS NULL OR resultado IN ('aprovado', 'aprovado_ressalva', 'reprovado')),
    corrigir_relatorio_ate     DATE,
    refazer_apresentacao_ate   DATE,
    comentarios         TEXT NOT NULL DEFAULT '',
    data_ata            DATE,
    criado_em           TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em       TIMESTAMP NOT NULL DEFAULT NOW()
);
