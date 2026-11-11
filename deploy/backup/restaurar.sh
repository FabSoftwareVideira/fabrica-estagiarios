#!/bin/sh
# Restaura o banco a partir de um backup (.dump gerado pelo backup.sh ou por
# pg_dump --format=custom).
#
# Uso (dentro do container de backup):
#   sh /opt/backup/restaurar.sh                 lista os backups disponíveis
#   sh /opt/backup/restaurar.sh ARQUIVO.dump    restaura (pede para digitar RESTAURAR)
#   sh /opt/backup/restaurar.sh ARQUIVO.dump --sim   restaura sem perguntar
#
# Como funciona:
#   1. confere o arquivo (SHA-256, se houver, e pg_restore --list);
#   2. faz um backup "antes-da-restauracao" do estado atual, para poder desfazer;
#   3. derruba as conexões abertas no banco;
#   4. numa única transação, apaga o schema public e recria tudo a partir do backup.
#      Se qualquer comando falhar, nada muda no banco.
# Depois, rode as migrações (o backup pode ser de uma versão anterior do sistema).
set -eu

DIR="${BACKUP_DIR:-/backups}"
export PGHOST="${PGHOST:-${POSTGRES_HOST:-fabrica-estagiarios-db}}"
export PGPORT="${POSTGRES_PORT:-5432}"
export PGUSER="${POSTGRES_USER:?defina POSTGRES_USER}"
export PGPASSWORD="${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD}"
export PGDATABASE="${POSTGRES_DB:?defina POSTGRES_DB}"

ARQUIVO="${1:-}"
CONFIRMADO="${2:-}"

if [ -z "$ARQUIVO" ]; then
    echo "Backups em $DIR (mais recentes primeiro):"
    ls -1t "$DIR"/*.dump 2>/dev/null | while read -r f; do
        echo "  $(basename "$f")  $(du -h "$f" | cut -f1)"
    done || true
    echo
    echo "Para restaurar: sh /opt/backup/restaurar.sh NOME_DO_ARQUIVO.dump"
    exit 1
fi

# aceita só o nome (procura em $DIR) ou um caminho completo
[ -f "$ARQUIVO" ] || ARQUIVO="$DIR/$ARQUIVO"
if [ ! -f "$ARQUIVO" ]; then
    echo "[restaurar] arquivo não encontrado: $ARQUIVO"
    exit 1
fi

if [ -f "$ARQUIVO.sha256" ]; then
    (cd "$(dirname "$ARQUIVO")" && sha256sum -c "$(basename "$ARQUIVO").sha256" > /dev/null) \
        || { echo "[restaurar] o SHA-256 não confere: o arquivo está corrompido."; exit 1; }
fi
pg_restore --list "$ARQUIVO" > /dev/null \
    || { echo "[restaurar] o pg_restore não consegue ler este arquivo."; exit 1; }

echo "Banco:   $PGDATABASE em $PGHOST"
echo "Backup:  $(basename "$ARQUIVO") ($(du -h "$ARQUIVO" | cut -f1))"
echo "Todos os dados atuais do banco serão substituídos pelos do backup."
if [ "$CONFIRMADO" != "--sim" ]; then
    printf 'Digite RESTAURAR para continuar: '
    read -r resposta
    [ "$resposta" = "RESTAURAR" ] || { echo "[restaurar] cancelado."; exit 1; }
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
    pg_restore --no-owner --no-privileges --file=- "$ARQUIVO" | grep -v '^CREATE SCHEMA public;$'
} | psql -v ON_ERROR_STOP=1 --single-transaction -q -o /dev/null

echo "[restaurar] concluído."
echo "Agora aplique as migrações, caso o backup seja de uma versão anterior do sistema:"
echo "  no Dokploy, faça um novo Deploy (o serviço 'migrar' roda antes do app), ou"
echo "  docker exec <container do web> node src/scripts/runMigrations.js"
echo "Para desfazer esta restauração, restaure o arquivo estagiarios_antes-da-restauracao_* mais recente."
