-- O relógio do relatório mede a ação do estudante, não a data da atividade
-- nem a validação feita pelo supervisor.
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS relatorio_atualizado_em TIMESTAMP;
UPDATE alunos a SET relatorio_atualizado_em = GREATEST(a.criado_em,
    (SELECT MAX(criado_em) FROM atividades WHERE aluno_id = a.usuario_id))
WHERE relatorio_atualizado_em IS NULL;
ALTER TABLE alunos ALTER COLUMN relatorio_atualizado_em SET DEFAULT NOW();
ALTER TABLE alunos ALTER COLUMN relatorio_atualizado_em SET NOT NULL;

CREATE OR REPLACE FUNCTION registrar_atualizacao_relatorio() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE alunos SET relatorio_atualizado_em = NOW() WHERE usuario_id = NEW.aluno_id;
    ELSIF (NEW.data, NEW.hora_inicio, NEW.hora_fim, NEW.horas, NEW.descricao)
        IS DISTINCT FROM (OLD.data, OLD.hora_inicio, OLD.hora_fim, OLD.horas, OLD.descricao) THEN
        UPDATE alunos SET relatorio_atualizado_em = NOW() WHERE usuario_id = NEW.aluno_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS atividades_atualizam_relatorio ON atividades;
CREATE TRIGGER atividades_atualizam_relatorio AFTER INSERT OR UPDATE ON atividades
FOR EACH ROW EXECUTE FUNCTION registrar_atualizacao_relatorio();

CREATE OR REPLACE FUNCTION iniciar_prazo_relatorio() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'em_andamento' AND
       (OLD.status = 'lista_espera' OR (OLD.arquivado AND NOT NEW.arquivado)) THEN
        NEW.relatorio_atualizado_em = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS alunos_iniciam_prazo_relatorio ON alunos;
CREATE TRIGGER alunos_iniciam_prazo_relatorio BEFORE UPDATE ON alunos
FOR EACH ROW EXECUTE FUNCTION iniciar_prazo_relatorio();

CREATE TABLE IF NOT EXISTS lembretes_atividades (
    aluno_id INTEGER PRIMARY KEY REFERENCES alunos(usuario_id) ON DELETE CASCADE,
    enviado_em TIMESTAMP,
    proximo_envio_em TIMESTAMP NOT NULL
);
