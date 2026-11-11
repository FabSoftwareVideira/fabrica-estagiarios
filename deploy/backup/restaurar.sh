#!/bin/sh
# Restaura o banco a partir de um backup .dump (formato custom do pg_dump): um dos
# backups automáticos ou um dump trazido de outra VPS.
#
# Uso (dentro do container de backup):
#   sh /opt/backup/restaurar.sh                      lista os backups da pasta
#   sh /opt/backup/restaurar.sh ARQUIVO.dump         restaura (pede para digitar RESTAURAR)
#   sh /opt/backup/restaurar.sh ARQUIVO.dump --sim   restaura sem perguntar
#
# O banco só é tocado depois que o arquivo passa em todas as conferências:
#   1. SHA-256 (quando houver o .sha256 ao lado);
#   2. o pg_restore consegue ler o arquivo;
#   3. o arquivo tem as tabelas deste sistema (usuarios, alunos), ou seja, não está
#      vazio e não é de outro banco;
#   4. o arquivo é convertido inteiro para SQL sem erro.
# Depois: backup "antes-da-restauracao" do estado atual, encerra as conexões e
# recria o banco numa única transação (se algo falhar, nada muda).
# Em seguida, faça um novo Deploy no Dokploy para aplicar as migrações.
set -eu

DIR="${BACKUP_DIR:-/backups}"
export PGHOST="${POSTGRES_HOST:-fabrica-estagiarios-db}"
export PGPORT="${POSTGRES_PORT:-5432}"
export PGUSER="${POSTGRES_USER:?defina POSTGRES_USER}"
export PGPASSWORD="${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD}"
export PGDATABASE="${POSTGRES_DB:?defina POSTGRES_DB}"

ARQUIVO="${1:-}"
CONFIRMADO="${2:-}"
erro() { echo "[restaurar] ERRO: $*"; echo "[restaurar] o banco NÃO foi alterado."; exit 1; }

if [ -z "$ARQUIVO" ]; then
    echo "Backups em $DIR (mais recentes primeiro):"
    ls -1t "$DIR"/*.dump 2>/dev/null | while read -r f; do
        echo "  $(basename "$f")  $(du -h "$f" | cut -f1)"
    done || true
    echo
    echo "Para restaurar: sh /opt/backup/restaurar.sh NOME_DO_ARQUIVO.dump"
    exit 1
fi

# aceita só o nome (procura na pasta de backups) ou um caminho dentro do container
[ -f "$ARQUIVO" ] || ARQUIVO="$DIR/$ARQUIVO"
[ -f "$ARQUIVO" ] || erro "arquivo não encontrado: $ARQUIVO"
[ -r "$ARQUIVO" ] || erro "sem permissão de leitura em $ARQUIVO (usuário $(id -u)). Rode na VPS: sudo chmod 644 <arquivo>"
[ -s "$ARQUIVO" ] || erro "o arquivo está vazio (0 bytes). Gere o dump de novo."

if [ -f "$ARQUIVO.sha256" ]; then
    (cd "$(dirname "$ARQUIVO")" && sha256sum -c "$(basename "$ARQUIVO").sha256" > /dev/null 2>&1) \
        || erro "o SHA-256 não confere: o arquivo está corrompido."
fi

indice="$(pg_restore --list "$ARQUIVO" 2>/dev/null)" \
    || erro "o pg_restore não consegue ler este arquivo. Ele precisa ser gerado com pg_dump -Fc."
for tabela in usuarios alunos; do
    echo "$indice" | grep -qE " TABLE (public )?$tabela( |$)" \
        || erro "o arquivo não tem a tabela '$tabela': não parece ser um backup deste sistema."
done
tabelas="$(echo "$indice" | grep -cE ' TABLE (public )?[^ ]+ ' || true)"

# converte tudo antes de mexer no banco: qualquer problema aparece aqui
sql="$(mktemp)"
trap 'rm -f "$sql"' EXIT
pg_restore --no-owner --no-privileges --file="$sql" "$ARQUIVO" 2>/dev/null \
    || erro "não foi possível converter o arquivo para SQL."

echo "Banco:   $PGDATABASE em $PGHOST"
echo "Backup:  $(basename "$ARQUIVO") ($(du -h "$ARQUIVO" | cut -f1), $tabelas tabelas)"
echo "Todos os dados atuais do banco serão substituídos pelos do backup."
if [ "$CONFIRMADO" != "--sim" ]; then
    printf 'Digite RESTAURAR para continuar: '
    read -r resposta
    [ "$resposta" = "RESTAURAR" ] || { echo "[restaurar] cancelado; o banco não foi alterado."; exit 1; }
fi

echo "[restaurar] guardando o estado atual antes de restaurar..."
sh /opt/backup/backup.sh antes-da-restauracao

echo "[restaurar] encerrando as conexões abertas..."
psql -v ON_ERROR_STOP=1 -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid();" > /dev/null

echo "[restaurar] restaurando (em uma única transação)..."
{
    echo 'SET client_min_messages TO warning;'
    echo 'DROP SCHEMA IF EXISTS public CASCADE;'
    echo 'CREATE SCHEMA public;'
    # sem a criação do schema public, que acabou de ser recriado acima
    grep -v '^CREATE SCHEMA public;$' "$sql" || true
} | psql -v ON_ERROR_STOP=1 --single-transaction -q -o /dev/null \
    || erro "a restauração falhou e foi desfeita."

usuarios="$(psql -tAc 'SELECT count(*) FROM usuarios')"
estagiarios="$(psql -tAc 'SELECT count(*) FROM alunos')"
echo "[restaurar] concluído: $usuarios usuários e $estagiarios estagiários no banco."
echo "Agora faça um novo Deploy no Dokploy: o serviço 'migrar' atualiza o banco caso o"
echo "backup seja de uma versão anterior do sistema."
echo "Para desfazer, restaure o arquivo estagiarios_antes-da-restauracao_* mais recente."
