#!/bin/sh
# Faz um backup do banco agora: pg_dump em formato custom, conferido com
# pg_restore --list antes de ser guardado, com o SHA-256 ao lado.
#
# Uso (dentro do container de backup):  sh /opt/backup/backup.sh [rótulo]
#   rótulo: diario (padrão, usado pelo agendador), manual, antes-da-restauracao...
# Só os backups "diario" são apagados pela retenção (BACKUP_RETENCAO_DIAS, padrão 14).
set -eu

DIR="${BACKUP_DIR:-/backups}"
RETENCAO="${BACKUP_RETENCAO_DIAS:-14}"
ROTULO="${1:-diario}"

export PGHOST="${POSTGRES_HOST:-fabrica-estagiarios-db}"
export PGPORT="${POSTGRES_PORT:-5432}"
export PGUSER="${POSTGRES_USER:?defina POSTGRES_USER}"
export PGPASSWORD="${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD}"
export PGDATABASE="${POSTGRES_DB:?defina POSTGRES_DB}"

# Brasília é UTC-3 o ano todo desde 2019 (sem horário de verão)
brasilia() { date -u -d "@$(( $(date -u +%s) - 10800 ))" "$@"; }

if [ ! -w "$DIR" ]; then
    echo "[backup] ERRO: sem permissão de escrita em $DIR (usuário $(id -u):$(id -g))."
    exit 1
fi

arquivo="$DIR/estagiarios_${ROTULO}_$(brasilia +%Y-%m-%d_%H%M%S).dump"
parcial="$arquivo.parcial"
trap 'rm -f "$parcial"' EXIT

echo "[backup] $(brasilia '+%d/%m/%Y %H:%M') gerando $(basename "$arquivo")..."
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$parcial"

# um arquivo que o pg_restore não consegue ler não serve como backup
pg_restore --list "$parcial" > /dev/null
mv "$parcial" "$arquivo"
(cd "$DIR" && sha256sum "$(basename "$arquivo")" > "$(basename "$arquivo").sha256")
echo "[backup] ok: $(basename "$arquivo") ($(du -h "$arquivo" | cut -f1))"

# retenção: só os diários; manuais e os feitos antes de uma restauração ficam até alguém apagar
find "$DIR" -maxdepth 1 -type f \( -name 'estagiarios_diario_*.dump' -o -name 'estagiarios_diario_*.dump.sha256' \) \
    -mtime "+$RETENCAO" -print -delete | sed 's#^#[backup] removido pela retenção: #'

# marca de sucesso: o healthcheck do container fica "unhealthy" se ela envelhecer demais
touch "$DIR/.ultimo-backup-ok"
