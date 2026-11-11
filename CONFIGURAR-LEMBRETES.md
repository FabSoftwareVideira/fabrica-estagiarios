# Configurar os lembretes de atividades

Guia de ativação — 10/11/2026.

## O que já está implementado

- Estudantes com estágio em andamento, não arquivado nem encerrado, recebem lembretes após **mais de 5 dias completos** sem registrar ou editar atividades. A conta precisa estar ativa e permitir os lembretes em **Meu perfil → E-mails da plataforma**.
- Registrar uma atividade retroativa ou editar data, horário, horas ou descrição reinicia a contagem. A validação do supervisor não reinicia o prazo.
- Sem atividades, o prazo começa no cadastro; ao iniciar o estágio ou desarquivar um estágio em andamento, ele recomeça.
- O e-mail individual pede atividades e horas, inclui estudante, matrícula, empresa, supervisor, orientador e carga horária disponíveis e aponta para `APP_URL/aluno/nova-atividade`.
- Intervalo de **7 dias entre lembretes**. Falhas explícitas de SMTP permitem nova tentativa após uma hora. A reserva antes do envio reduz duplicações; uma interrupção após a aceitação pelo SMTP pode adiar a próxima tentativa por sete dias.
- O envio usa o mesmo serviço e as mesmas credenciais SMTP do resumo semanal dos supervisores. Não é necessário criar outra conta de e-mail nem configurar o horário do resumo semanal para os lembretes funcionarem.
- O workflow consulta a elegibilidade a cada hora. GitHub Actions pode atrasar execuções; o envio não acontece necessariamente no minuto exato em que se completam cinco dias.

## O que você precisa fornecer ou confirmar

Se o resumo semanal já entrega mensagens, normalmente é suficiente manter a configuração atual e seguir os passos de deploy, diagnóstico e ativação abaixo.

1. **Endereço público do sistema:** por exemplo `https://estagios.seu-dominio.edu.br`, sem rota de login ou caminho adicional.
2. **Servidor SMTP:** host, porta, usuário e credencial de envio fornecidos pela instituição/provedor.
3. **Remetente permitido:** a conta SMTP ou um endereço que o provedor autorize essa conta a utilizar.
4. **Acesso administrativo ao repositório:** para editar o secret `ENV_FILE`, a variável de ativação e disparar o deploy.

Não envie a senha no chat e não a coloque em arquivos versionados. Ela deve ficar no secret `ENV_FILE`, junto das configurações de produção já existentes. Eu não consigo ler o valor desse secret pelo GitHub; sua configuração e a entrega externa precisam ser confirmadas no ambiente de produção.

## 1. Conferir o secret de produção

No repositório **FabSoftwareVideira/fabrica-estagiarios**, abra **Settings → Secrets and variables → Actions → Secrets → ENV_FILE**.

Mantenha as variáveis atuais do banco, login e sessão. Acrescente ou atualize apenas estas linhas, substituindo os exemplos:

```dotenv
APP_URL=https://estagios.seu-dominio.edu.br
SMTP_HOST=smtp.seu-provedor.com
SMTP_PORT=587
SMTP_USER=conta-de-envio@seu-dominio.edu.br
SMTP_PASS=SUA_CREDENCIAL_DE_ENVIO
SMTP_FROM=Controle de Estágio <conta-de-envio@seu-dominio.edu.br>
```

`SMTP_FROM` é opcional; sem ele, o sistema usa `SMTP_USER`. Porta `465` usa TLS desde a conexão; `587` usa STARTTLS quando anunciado pelo servidor. O servidor precisa conseguir acessar o host e a porta SMTP. Consulte os dados do seu provedor. [Referência do Nodemailer](https://nodemailer.com/smtp).

Para Gmail/Google Workspace com autenticação por senha: use `smtp.gmail.com`, porta `587`, endereço completo em `SMTP_USER` e uma **senha de app**, quando a organização permitir. A verificação em duas etapas é um pré-requisito; contas institucionais podem não disponibilizar senhas de app. Nesse caso, peça ao administrador o SMTP/relay autorizado. A senha normal da conta não substitui essa credencial. [Instruções oficiais do Google](https://support.google.com/accounts/answer/185833?hl=pt-BR).

Alterar o secret não atualiza o container que já está rodando: é necessário fazer outro deploy.

## 2. Publicar o código e fazer o deploy

1. Faça commit e push das alterações, incluindo os workflows, `src/scripts/lembretesAtividadesJob.js` e as migrações.
2. Abra **Actions → Continuous Deployment → Run workflow** e escolha a branch com a versão atual. Deixe `image_tag` vazio, pois esse campo é para rollback.
3. Aguarde a conclusão do deploy. Alternativamente, publique uma nova tag `v*` apontando para esse commit.

O workflow existente faz o build, aplica as migrações pendentes e atualiza o container. Para lembretes, são necessárias especialmente `016_lembretes_atividades.sql`, `021_gerenciamento_usuarios.sql` e `025_preferencias_email.sql`; não pule as demais migrações pendentes.

O novo workflow dos lembretes usa a mesma fila de concorrência do deploy. Ele não executa durante a troca do container. A fila não cancela o trabalho que já está em execução. [Concorrência no GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## 3. Fazer o diagnóstico sem enviar e-mails

Abra **Actions → Lembretes de atividades dos estudantes → Run workflow** e escolha **modo: diagnostico** (padrão).

O diagnóstico verifica colunas e gatilhos necessários, conta estudantes elegíveis e confere conexão/autenticação SMTP. **Não envia mensagens e não altera o intervalo de lembretes.** O log não lista estudantes nem imprime credenciais.

Resultado esperado:

```text
[lembretes] Banco e registro de atualizações disponíveis.
[lembretes] N estudante(s) elegível(is) neste momento.
[lembretes] SMTP conectado e autenticado. Nenhum e-mail enviado. ...
```

`N = 0` é normal se ninguém estiver atrasado. O diagnóstico confirma a conexão e a autenticação, mas não garante que o provedor aceite qualquer remetente nem que a mensagem chegue à caixa de entrada. Essas duas condições exigem um envio real. [Limites de SMTP verify](https://nodemailer.com/smtp).

Se aparecer **Aguardando deploy**, o workflow foi pulado porque o container ainda não contém o novo executor. Isso não significa diagnóstico aprovado: faça o passo 2 e rode novamente.

O modo **simular** apenas consulta o banco e conta elegíveis. Não conecta ao SMTP, não envia e não reserva prazos.

## 4. Ativar os envios automáticos

Depois do deploy e do diagnóstico:

1. Abra **Settings → Secrets and variables → Actions → Variables**.
2. Crie uma variável de repositório chamada `LEMBRETES_ATIVIDADES_ATIVOS`.
3. Defina o valor como `true`, em minúsculas.

Essa é uma **variável do GitHub Actions**, não uma linha do `ENV_FILE`. Sem ela, ou com valor `false`, as execuções agendadas ficam puladas. O arquivo do workflow precisa estar na branch padrão do repositório para que o agendamento funcione.

O primeiro envio acontecerá na próxima execução agendada que encontrar estudantes elegíveis. Para executar imediatamente, use **Run workflow → modo: enviar**. Esse modo **envia mensagens reais a todos os estudantes elegíveis**, mesmo se a variável de agendamento estiver desligada. Ele respeita a preferência individual, o prazo de cinco dias e o intervalo de sete dias.

Para pausar os próximos disparos automáticos, altere a variável para `false`. Isso não cancela um envio já iniciado nem impede execuções manuais explícitas.

## Comandos equivalentes no servidor

Use estes comandos no host que já executa o container de produção:

```sh
# Banco + autenticação SMTP, sem enviar
docker exec fabrica-estagiarios-web node /app/src/scripts/lembretesAtividadesJob.js --diagnostico

# Apenas consulta, sem SMTP e sem alterações no banco
docker exec fabrica-estagiarios-web node /app/src/scripts/lembretesAtividadesJob.js --simular

# Envio real para todos os elegíveis
docker exec fabrica-estagiarios-web node /app/src/scripts/lembretesAtividadesJob.js --enviar
```

Com as variáveis já carregadas no ambiente, os atalhos são `npm run email:reminders:check`, `npm run email:reminders:dry-run` e `npm run email:reminders`. Executar o Node diretamente não carrega um arquivo `.env` automaticamente; o Compose de produção já injeta essas variáveis.

No desenvolvimento com Docker, mantenha `DEV_SMTP_HOST=mailpit` para capturar mensagens em `http://localhost:8025`. Não use credenciais de produção para experimentar envios.

## Se houver erro

| Mensagem ou sintoma | Como resolver |
| --- | --- |
| Job `skipped` nas execuções agendadas | Conferir `LEMBRETES_ATIVIDADES_ATIVOS=true` em **Variables**. |
| `Aguardando deploy` | O container ainda usa uma versão antiga. Fazer o deploy do commit atual. |
| `Container web indisponível` | Conferir o workflow de deploy e se `fabrica-estagiarios-web` está em execução no runner. |
| `Banco não preparado para lembretes` | Aplicar as migrações pendentes com o deploy; conferir o campo/gatilho indicado no erro. |
| `Configure SMTP_*` ou `Configure APP_URL` | Corrigir `ENV_FILE` e fazer novo deploy. |
| `EAUTH`, `535`, usuário/senha recusados | Conferir credencial SMTP, senha de app e política da organização. |
| `ETIMEDOUT`, `ECONNREFUSED`, erro de DNS | Conferir host, porta e saída de rede do servidor. |
| Diagnóstico passa, mas envio falha | Conferir remetente autorizado, destinatário e limites do provedor no log. |
| `0 estudante(s) elegível(is)` | Conferir estágio ativo, conta ativa, preferência de e-mail, mais de cinco dias sem edição e intervalo desde o último lembrete. |
| SMTP aceitou, mas não chegou | Conferir spam/quarentena e os registros do provedor; aceitação SMTP não comprova entrega. 
