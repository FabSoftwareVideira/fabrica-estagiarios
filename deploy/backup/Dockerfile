# Imagem do serviço de backup: ferramentas do PostgreSQL (mesma versão do banco)
# com os scripts de backup e restauração dentro dela.
#
# Os scripts são copiados para a imagem, e não montados da pasta do código: o
# Dokploy apaga e clona o código de novo a cada deploy, e um container que não é
# recriado ficaria apontando para a pasta antiga, já apagada.
FROM postgres:16-alpine

COPY agendador.sh backup.sh restaurar.sh /opt/backup/

CMD ["sh", "/opt/backup/agendador.sh"]
