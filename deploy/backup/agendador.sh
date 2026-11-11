#!/bin/sh
# Processo principal do container de backup: um backup "diario" por dia, a partir
# do horário BACKUP_HORA (HH:MM, horário de Brasília, padrão 03:00).
#
# Se o container estava parado no horário (deploy, reinício da VPS), o backup do
# dia é feito assim que ele volta. Uma falha é tentada de novo depois de 30 minutos.
set -u

DIR="${BACKUP_DIR:-/backups}"
HORA="${BACKUP_HORA:-03:00}"
case "$HORA" in
    [0-2][0-9]:[0-5][0-9]) ;;
    *) echo "[backup] BACKUP_HORA inválida: '$HORA' (use HH:MM). Usando 03:00."; HORA="03:00" ;;
esac
ALVO="$(echo "$HORA" | tr -d ':')"
MARCA="$DIR/.ultimo-diario"

brasilia() { date -u -d "@$(( $(date -u +%s) - 10800 ))" "$@"; }

mkdir -p "$DIR"
echo "[backup] agendador ativo: backup diário a partir das $HORA (Brasília), retenção de ${BACKUP_RETENCAO_DIAS:-14} dias em $DIR"

while true; do
    hoje="$(brasilia +%Y-%m-%d)"
    agora="$(brasilia +%H%M)"
    feito="$(cat "$MARCA" 2>/dev/null || true)"
    if [ "$feito" != "$hoje" ] && [ "$agora" -ge "$ALVO" ]; then
        if sh /opt/backup/backup.sh diario; then
            echo "$hoje" > "$MARCA"
        else
            echo "[backup] ERRO: o backup diário falhou; nova tentativa em 30 minutos."
            sleep 1800
            continue
        fi
    fi
    sleep 60
done
