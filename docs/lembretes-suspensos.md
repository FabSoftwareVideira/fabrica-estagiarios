# Histórico da suspensão dos lembretes

**Atualização em 10/11/2026:** o workflow foi reintroduzido com ativação por variável, diagnóstico sem envio, conferência do schema/container e fila compartilhada com o deploy. Para configurar a versão atual, consulte [CONFIGURAR-LEMBRETES.md](CONFIGURAR-LEMBRETES.md). O conteúdo abaixo registra a suspensão anterior.

O workflow automático foi removido em 09/11/2026 a pedido do responsável pelo projeto. A implementação permanece no repositório para revisão posterior. A agenda de bancas, a FAC, os temas e o resumo semanal dos supervisores não dependem desse workflow.

## Causa identificada

A [execução de lembretes 42585913494](https://github.com/FabSoftwareVideira/fabrica-estagiarios/actions/runs/42585913494) falhou no comando:

```sh
docker exec fabrica-estagiarios-web node src/scripts/enviarLembretesAtividades.js
```

O log registrou `Cannot find module '/app/src/scripts/enviarLembretesAtividades.js'` (`MODULE_NOT_FOUND`). A falha ocorreu antes de executar o script, consultar a elegibilidade ou conectar ao SMTP.

O workflow agendado já usava o commit `b3d85cb`, mas o [último deploy concluído](https://github.com/FabSoftwareVideira/fabrica-estagiarios/actions/runs/41524690326), em 02/11/2026, era do commit anterior `43127e3`. O container ainda não continha o novo script. O workflow de deploy é acionado por tags `v*` ou manualmente; um push comum na branch não atualiza o container. O agendamento dos lembretes havia sido ativado sem verificar se a versão correspondente já estava implantada.

## Estado durante a suspensão de 09/11/2026

- Sem workflow de lembretes em `.github/workflows`, não há disparo automático desse recurso após esta alteração chegar à branch padrão do GitHub.
- A migração `016_lembretes_atividades.sql` foi mantida para preservar o histórico e a compatibilidade dos dados. Ela não envia e-mails.
- O script e o comando manual `npm run email:reminders` foram preservados. Não executar esse comando em produção durante a suspensão.
- Para retomar: implantar a versão contendo o script, aplicar as migrações, conferir a configuração SMTP e só então recriar o workflow. O futuro workflow deve verificar a disponibilidade do script/schema e evitar execução simultânea com a troca do container no deploy.
- A demonstração local continua usando transporte de captura, sem SMTP externo.
