# Fábrica Template Node.js + Express + PostgreSQL

Template padrão para aplicações Node.js + Express + PostgreSQL com CI/CD via GitHub Actions. Use esse repositório como base para seus projetos, adaptando as rotas, lógica e banco conforme necessário. Siga as instruções abaixo:

> **Nota**: Este template está pronto para ser usado em produção no servidor da Fábrica de Software do IFC Campus Videira.

## Stack

- **Runtime**: Node.js 25
- **Framework**: Express
- **Banco**: PostgreSQL 18.3
- **Container**: Docker (multi-stage: dev + prod)
- **CI/CD**: GitHub Actions → Dokploy

## Início rápido

```bash
# 1. Copiar variáveis de ambiente
cp .env.sample .env
# Edite .env com suas credenciais

# 2. Subir em modo dev (com hot reload)
docker compose -f docker-compose.dev.yml up -d --build

# 3. Acessar
open http://localhost:3000
```

No modo de desenvolvimento, o Docker Compose inicia o Mailpit. Os e-mails enviados pela aplicação são capturados localmente e podem ser vistos em [http://localhost:8025](http://localhost:8025); o serviço SMTP fica acessível apenas pela rede interna do Compose. Os parâmetros do Mailpit vêm das variáveis `DEV_SMTP_*` no `.env` (com padrão seguro `mailpit:1025`) e sobrescrevem as variáveis `SMTP_*`, então credenciais SMTP reais já existentes no `.env` não serão usadas pelo container de desenvolvimento. Mantenha `DEV_SMTP_HOST=mailpit` para que os e-mails de teste não sejam enviados a destinatários reais.

Para preencher o banco de desenvolvimento com dados fictícios, execute `docker compose -f docker-compose.dev.yml exec -T estagiarios-web npm run seed:dev`. O seed idempotente cria 12 estudantes vinculados a três supervisores, um supervisor externo aprovado e três orientadores, além de atividades de exemplo. Na tela de login, abra **Acessos de desenvolvimento** para entrar como estudante (`estudante04@example.test`), supervisor (`supervisora1@example.test`), supervisor externo (`supervisor.externo@example.test`) ou orientador (`orientador1@example.test`). O supervisor externo de teste acompanha os três primeiros estudantes. Essas contas só autenticam em desenvolvimento; os endereços `.test` são fictícios.

Ao aprovar o cadastro do estudante, informe os dias e o horário contínuo planejado para cada dia (até 6 horas). A escala é mostrada no calendário e no formulário de atividades como referência, mas não limita os registros: o estudante pode registrar atividades em qualquer dia, exceto domingo, respeitando o limite de 6 horas por dia.

Todos entram pelo botão do Google na página inicial (o login é só com Google). No primeiro acesso com e-mail fora de `@ifc.edu.br`, a pessoa escolhe entre continuar como estudante ou solicitar perfil de supervisor externo; o pedido coleta empresa e função e aguarda aprovação de um professor. Depois da aprovação, o professor pode vincular o supervisor a estudantes; ele verá apenas esses estudantes e poderá validar atividades e preencher a FAC, sem acesso às funções de orientador ou administrador, à FAA, à FAPO, à banca ou à ata. No painel do supervisor, cada supervisionado aparece em um card, com filtro simplificado entre **Em andamento** e **Concluído**; quem cumpriu a carga horária e ainda não tem FAC aparece em um destaque no topo com acesso direto ao preenchimento. As migrações `019_supervisor_externo.sql` e `020_dados_supervisor_externo.sql` são aplicadas automaticamente no modo de desenvolvimento e no deploy.

Administradores gerenciam estudantes, professores e supervisores externos em **Administração → Usuários** (`/professor/usuarios`): podem cadastrar contas por tipo, ativar/desativar contas, promover professores a administrador e excluir contas sem vínculos associados. A lista tem busca, filtros, ordenação e paginação; o cadastro fica em uma tela separada. Solicitações de supervisores externos aparecem em destaque e podem ser aprovadas por um orientador, administrador ou outro supervisor já aprovado. E-mails são únicos sem diferenciar maiúsculas de minúsculas. A desativação preserva os dados, bloqueia novos logins e invalida sessões abertas na próxima requisição. As migrações `021_gerenciamento_usuarios.sql` e `022_email_unico_case_insensitive.sql` são aplicadas automaticamente no desenvolvimento e no deploy.

## Login com Google

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto, configure a tela de consentimento OAuth e crie um cliente OAuth do tipo **Aplicativo da Web**.
2. Adicione `http://localhost:3000/auth/google/callback` como URI de redirecionamento autorizado.
3. Preencha no `.env`:

```env
GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=seu-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

Em produção, use a URL HTTPS pública da aplicação em `GOOGLE_CALLBACK_URL` e cadastre exatamente essa mesma URL no Google Cloud Console. Em um banco já existente, aplique `db/migrations/002_google_id.sql` antes do primeiro login com Google.

## Relatório semanal por e-mail

O administrador configura o envio em **Administração → Relatório semanal por e-mail**. É possível habilitar/desabilitar e escolher o dia e horário, ou usar **Enviar resumo agora**. A tela lista os supervisores com estudantes ativos e quantos alunos cada um possui. Cada professor pode desativar o recebimento no próprio perfil. O envio automático começa desabilitado.

O serviço `relatorio-semanal` do Compose de produção verifica a programação a cada 15 minutos, e o script envia no dia/horário configurados pelo administrador (fuso `America/Sao_Paulo`). O envio manual ignora a programação automática, mas respeita as preferências dos professores. Em ambos os casos, sai uma única mensagem para o endereço SMTP configurado, com os supervisores elegíveis em cópia oculta (BCC). O conteúdo é consolidado e agrupa os estudantes por supervisor. O resumo mostra as horas registradas e as atividades preenchidas nos últimos 7 dias; as horas incluem atividades pendentes de validação e excluem atividades invalidadas. Cada aluno tem um link para os detalhes na aplicação.

O serviço `migrar` do Compose de produção aplica automaticamente as migrações pendentes em ordem, usando `src/scripts/runMigrations.js`, antes de iniciar o container web. O histórico fica registrado na tabela `schema_migrations`. Na primeira execução em bancos legados, o runner verifica se o schema já está no estado esperado até a migração 010 e registra esse baseline; caso não esteja, o deploy para com uma mensagem de erro em vez de presumir e pular migrações antigas. Em instalações novas, `db/init.sql` cria a estrutura atual e o runner aplica e registra as migrações recentes de forma idempotente.

Em desenvolvimento, `npm run dev` aplica automaticamente as migrações pendentes antes de iniciar o servidor. Para aplicar sem reiniciar a aplicação, execute `docker exec fabrica-estagiarios-dev-web node src/scripts/runMigrations.js`.

Adicione estas variáveis ao `ENV_FILE` configurado nos GitHub Actions (e ao `.env` da VPS):

```env
APP_URL=https://seu-dominio
SMTP_HOST=smtp.seu-provedor.com
SMTP_PORT=587
SMTP_USER=usuario-smtp
SMTP_PASS=senha-smtp
SMTP_FROM=Fábrica de Estagiários <nao-responda@seu-dominio>
```

`SMTP_FROM` é opcional e, se omitido, usa `SMTP_USER` como remetente. O serviço de relatório roda no Compose do Dokploy e envia os e-mails após a implantação da nova versão da aplicação.

Para Gmail/Google Workspace, use `smtp.gmail.com`, porta `587`, o endereço completo da conta em `SMTP_USER` e uma **senha de app** em `SMTP_PASS` (não a senha normal da conta). Se o Google mostrar os 16 caracteres em grupos separados por espaços, o serviço remove esses espaços automaticamente. Após alterar o secret `ENV_FILE`, faça um novo deploy para recriar o container com as credenciais atualizadas.

Para produção, atualize também o secret `ENV_FILE` no GitHub e faça o deploy para que o container web receba as novas variáveis de SMTP e `APP_URL`. Depois da migração e do deploy, entre com a conta admin, configure o dia/horário e habilite os envios.

## Estrutura

```
├── src/
│   ├── app.js              # Express app
│   ├── server.js           # Entry point
│   ├── config/
│   │   └── database.js     # Pool do PostgreSQL
│   └── routes/
│       ├── index.js        # Página inicial
│       └── api.js          # Rotas da API
|   |── views/
|       └── index.html      # Template HTML
├── .github/
│   └── workflows/
│       └── deploy.yml         # Deploy de produção (Dokploy)
├── Dockerfile                  # Multi-stage: dev | deps | prod
├── docker-compose.dev.yml     # Desenvolvimento
├── docker-compose.yml         # Produção (Dokploy)
└── .env.example
```

## Endpoints

| Método | Rota         | Descrição                          |
| ------ | ------------ | ---------------------------------- |
| GET    | `/`          | Página inicial (HTML)              |
| GET    | `/health`    | Health check com status do banco   |
| GET    | `/api/hello` | Exemplo de rota com query no banco |

## Adaptar para novo projeto

1. Renomeie o nome do projeto:
   - `name` em `package.json`
   - `name` em `docker-compose.yml` e `docker-compose.dev.yml`
2. Atualize o workflow `deploy.yml` e configure os secrets do Dokploy no GitHub.

---

## Deploy no Dokploy

A produção é implantada exclusivamente em uma VPS com [Dokploy](https://dokploy.com), usando `docker-compose.yml` e o workflow `deploy.yml`.

Diferenças do `docker-compose.yml`:

- **Sem porta publicada e sem a rede `fabrica-network`.** Só o serviço web entra na rede `dokploy-network`, por onde o Traefik do Dokploy o alcança; o banco fica só na rede interna do projeto.
- **Migrações dentro do compose**: o serviço `migrar` roda `runMigrations.js` a cada deploy, depois que o banco está saudável; o web só sobe se as migrações terminarem sem erro.
- **Relatório semanal dentro do compose**: o serviço `relatorio-semanal` verifica a programação a cada 15 minutos.
- **Sem `container_name`**: o Dokploy nomeia os containers.

Configuração no Dokploy (uma vez):

1. Crie um recurso **Docker Compose** apontando para este repositório, com **Compose Path** `./docker-compose.yml`. Deixe o *Autodeploy* desligado: quem dispara o deploy é o GitHub Actions, nas tags `v*`.
2. Na aba **Environment**, cole as mesmas variáveis do secret `ENV_FILE`. `POSTGRES_HOST` pode ficar como está: o compose usa sempre o serviço `fabrica-estagiarios-db`. Se o domínio mudar, atualize `APP_URL` e `GOOGLE_CALLBACK_URL` e cadastre o novo endereço de retorno no Google Cloud.
3. Na aba **Domains**, adicione o domínio para o serviço `fabrica-estagiarios-web`, porta `3000`, com HTTPS.
4. No GitHub, crie os secrets `DOKPLOY_URL`, `DOKPLOY_API_KEY` (token em Settings → Profile do Dokploy) e `DOKPLOY_COMPOSE_ID` (o id do recurso, na URL dele no painel). Sem eles, o workflow `deploy.yml` só valida o compose.

Para importar um backup existente, siga "Trazer os dados da VPS antiga" em "Backup e restauração", abaixo.

## Backup e restauração

No Dokploy, o serviço `backup` do `docker-compose.yml` faz um backup do banco por dia numa pasta da VPS: `/srv/fabrica-estagiarios/backups` (configurável por `BACKUP_HOST_DIR`). Os scripts ficam em `deploy/backup/` e vão dentro da imagem do serviço.

- **Pasta**: criada automaticamente a cada deploy, se não existir. O serviço `preparar-pasta-backup` passa a pasta para o usuário do container de backup (UID/GID 70, o usuário `postgres` da imagem), que não roda como root.
- **Quando**: todo dia a partir de `BACKUP_HORA` (Brasília, padrão `03:00`). Se o container estava parado no horário, o backup do dia sai assim que ele volta; uma falha é tentada de novo em 30 minutos.
- **Como**: `pg_dump` em formato custom, conferido com `pg_restore --list`, com um `.sha256` ao lado. Nomes no formato `estagiarios_diario_2026-11-10_030000.dump`.
- **Retenção**: os diários ficam `BACKUP_RETENCAO_DIAS` dias (padrão 14). Backups manuais, os feitos antes de uma restauração e os arquivos trazidos de fora não são apagados automaticamente.
- **Alerta**: o container fica *unhealthy* no Dokploy se o último backup bem-sucedido tiver mais de 26 horas.

Variáveis opcionais na aba **Environment** do Dokploy:

```env
BACKUP_HOST_DIR=/srv/fabrica-estagiarios/backups
BACKUP_HORA=03:00
BACKUP_RETENCAO_DIAS=14
```

Os backups ficam na mesma VPS do banco: protegem contra erro humano e dados corrompidos, mas não contra a perda da VPS. Copie a pasta para outro lugar de tempos em tempos (por exemplo, com `rsync` ou `scp`).

### Comandos

Os comandos rodam no terminal da VPS nova. O container de backup se chama `<recurso>-backup-1` (por exemplo, `fabrica-estagiarios-5rloou-backup-1`):

```bash
docker ps --filter "name=backup" --format "{{.Names}}"
```

Backup manual (por exemplo, antes de uma mudança arriscada):

```bash
docker exec <container-backup> sh /opt/backup/backup.sh manual
```

Listar os backups:

```bash
docker exec <container-backup> sh /opt/backup/restaurar.sh
```

Restaurar (pede para digitar `RESTAURAR`):

```bash
docker exec -it <container-backup> sh /opt/backup/restaurar.sh estagiarios_diario_2026-11-10_030000.dump
```

Antes de tocar no banco, a restauração confere o arquivo e recusa, sem alterar nada, arquivos vazios, corrompidos (SHA-256), ilegíveis para o `pg_restore` ou sem as tabelas deste sistema. Depois, guarda um backup `antes-da-restauracao` do estado atual (para desfazer), encerra as conexões e recria o banco numa única transação: se algo falhar, nada muda. Ao terminar, mostra quantos usuários e estagiários ficaram no banco.

**Depois de restaurar, faça um novo Deploy no Dokploy**: o serviço `migrar` atualiza o banco caso o backup seja de uma versão anterior do sistema.

### Trazer os dados da VPS antiga

1. Na VPS antiga, gere o dump. O `sh -c '...'` faz as variáveis serem lidas dentro do container:

   ```bash
   docker exec fabrica-estagiarios-db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > estagiarios-vps-antiga.dump
   ```

2. Confira que o arquivo não está vazio e é um dump do PostgreSQL. O tamanho deve ser de dezenas de KB ou mais, e o segundo comando deve mostrar `PGDMP`:

   ```bash
   ls -lh estagiarios-vps-antiga.dump
   ```

   ```bash
   head -c 5 estagiarios-vps-antiga.dump; echo
   ```

3. Envie para a VPS nova:

   ```bash
   scp estagiarios-vps-antiga.dump usuario@IP-DA-VPS-NOVA:/tmp/
   ```

4. Na VPS nova, coloque o arquivo na pasta de backups (ela pertence ao usuário do container, por isso o `sudo`):

   ```bash
   sudo cp /tmp/estagiarios-vps-antiga.dump /srv/fabrica-estagiarios/backups/
   ```

   ```bash
   sudo chmod 644 /srv/fabrica-estagiarios/backups/estagiarios-vps-antiga.dump
   ```

5. Restaure e, em seguida, faça um novo Deploy no Dokploy:

   ```bash
   docker exec -it <container-backup> sh /opt/backup/restaurar.sh estagiarios-vps-antiga.dump
   ```

Se a VPS antiga continuar recebendo uso depois do dump, o que for gravado lá depois não vem junto. Para a migração definitiva, pare o site antigo antes do passo 1 (`docker stop fabrica-estagiarios-web`).

## Encerramento do estágio e ata da banca (FARE)

- O orientador abre **Fichas** no menu, preenche a FAPO e a ata da banca (média da FAC salva pelo supervisor, ou nota da ficha em papel, notas N1/N2/N3 de cada critério, avaliadores, resultado e comentários).
- A nota final é a soma de (nota x peso) dividida por 10. A FAA vem da ficha do aluno (ou é digitada se o aluno não preencheu) e a FAPO vem da ficha salva.
- Ao **concluir o estágio** (`alunos.encerrado_em`), o aluno não registra mais atividades nem altera a FAA, e o supervisor não valida mais horas: só é possível consultar e imprimir. O orientador (ou admin) pode **reabrir** o estágio.
- Migração: `db/migrations/014_ata_banca.sql` (coluna `encerrado_em` e tabela `fares`). O modelo do PDF fica em `docs/FARE - Avaliação-Estágio-Ata-Banca-.pdf`.

## Lembretes de atividades para estudantes

O workflow `.github/workflows/lembretes-atividades.yml` verifica os atrasos a cada hora, após ativar a variável de repositório `LEMBRETES_ATIVIDADES_ATIVOS=true` no GitHub Actions. Sem essa variável, os disparos agendados ficam pulados. Ele compartilha a fila de execução do deploy e confere a existência do executor no container antes de chamá-lo. Siga o [guia de configuração e ativação](docs/CONFIGURAR-LEMBRETES.md) para fazer o deploy, conferir SMTP sem enviar mensagens e habilitar o agendamento.

A implementação identifica estudantes com conta ativa e estágio em andamento, não arquivado e não encerrado, que passam **mais de 5 dias completos** sem registrar ou atualizar atividades. Respeita a preferência de e-mail do estudante e reutiliza o serviço SMTP e as variáveis `APP_URL`/`SMTP_*` do resumo semanal.

O prazo considera a data do registro/alteração, mesmo para atividades retroativas. Validações do supervisor não reiniciam a contagem. Para alunos sem atividades, considera-se o cadastro; ao sair da lista de espera ou desarquivar um estágio em andamento, o prazo recomeça. Na migração de dados existentes, usa-se o registro mais recente disponível (ou a criação do aluno); não há histórico de edições anterior à migração.

Cada estudante recebe no máximo um lembrete a cada **7 dias**, enquanto continuar elegível. A mensagem inclui nome, matrícula, empresa, supervisor, orientador e carga horária conforme disponíveis, além do link para registrar atividades e horas. Um lock no PostgreSQL impede execuções simultâneas. O intervalo é reservado antes do SMTP para evitar duplicação se o processo parar após a aceitação; em falhas explícitas de SMTP, a tentativa é adiada por uma hora. Uma interrupção durante o envio pode adiar esse lembrete até a próxima janela de sete dias.

O executor verifica o schema necessário, incluindo as migrações 016, 021 e 025, antes de processar lembretes. `npm run email:reminders:check` verifica banco e conexão/autenticação SMTP, sem enviar. `npm run email:reminders:dry-run` apenas conta elegíveis, sem SMTP nem alterações no banco. `npm run email:reminders` **envia e-mails reais** para todos os elegíveis. Esses três modos também estão disponíveis em **Run workflow**, com diagnóstico como padrão. O envio manual não depende da variável do agendamento.

## Alto contraste

A interface usa sempre o tema claro. O botão "Alto contraste" na barra superior alterna o modo de alto contraste em todas as páginas; a escolha é salva em `localStorage` (chave `contraste`) e reaplicada nas próximas visitas.

## Papéis

Estudantes e supervisores externos têm um papel só. As contas internas (`@ifc.edu.br`) podem acumular papéis, definidos pelo administrador em **Administração → Usuários e papéis**. O botão de lápis na linha da pessoa abre a tela de edição, onde o administrador altera nome, e-mail e os dados do tipo de conta (matrícula e curso do estudante, papéis da conta interna, empresa e função do supervisor externo). Um professor pode ser orientador e supervisor ao mesmo tempo:

| Papel | O que permite |
|---|---|
| Administrador | Gerencia usuários e papéis e vê todos os estágios. |
| Servidor (setor de estágios) | Acompanha todos os estagiários pelo **Acompanhamento dos estágios**, que é a tela inicial de quem tem esse papel. |
| Orientador | Pode ser orientador de estudantes e avaliador de bancas. |
| Supervisor | Pode ser supervisor de estudantes e validar atividades. |

Todo `@ifc.edu.br` entra, no primeiro acesso, como orientador e supervisor (o e-mail não distingue professor de técnico); o administrador ajusta depois, ou cadastra a conta já como "Servidor (setor de estágios)". Quem é só servidor não vê a tela **Alunos**: a lista de estudantes dele fica no próprio acompanhamento. Um papel não pode ser retirado enquanto a pessoa tiver estudantes ou bancas em aberto nele, ninguém altera os próprios papéis e é obrigatório manter ao menos um.

No banco, administrador é `professores.cargo = 'admin'` e os demais papéis ficam em `papel_servidor`, `papel_orientador` e `papel_supervisor` (migrações `026_papel_servidor.sql` e `027_papeis_multiplos.sql`); as regras estão em `src/config/papeis.js`. Em desenvolvimento, a tela de login tem o atalho "Entrar como Servidor".

## Inclusão de estágios (setor de estágios)

O setor de estágios costuma ser o primeiro contato do estudante. Quem tem o papel de servidor vê **Inclusão de estágios** no menu (o administrador chega pelo botão "Incluir estágio" do Acompanhamento). O fluxo tem cinco etapas:

1. **Estagiário**: escolher um estudante da lista de espera ou cadastrar um novo (nome, e-mail, matrícula opcional e curso). Para o novo, a conta é criada na conclusão; ele entra depois com a conta Google desse e-mail.
2. **Responsáveis**: orientador (obrigatório) e supervisor (opcional).
3. **Estágio**: empresa e carga horária.
4. **Horários**: dias e horários de trabalho.
5. **Revisão**: resumo e "Concluir inclusão", que deixa o estágio em andamento, como a aprovação de cadastro.

"Salvar rascunho" grava o formulário como está, em qualquer etapa; a lista de rascunhos fica em **Inclusão de estágios**, e qualquer pessoa do setor pode continuar de onde parou. Ao concluir, o rascunho é apagado. Os rascunhos ficam na tabela `estagios_rascunhos` (migração `029_rascunhos_inclusao_estagio.sql`).

## Acompanhamento (administrador e servidor)

Em **Administração → Acompanhamento dos estágios** (ou no menu **Acompanhamento**, para o servidor; `/professor/acompanhamento`), o administrador ou o servidor vê quantos estudantes estão em cada etapa (lista de espera, em andamento, aguardando banca, encerrado), a distribuição por curso e a lista de estudantes com etapa, horas e pendências (cadastro a aprovar, sem orientador ou supervisor, mais de 5 dias sem registrar, horas aguardando validação, banca não agendada, curso não informado). Estágios arquivados e contas desativadas não entram.

## Agenda de bancas

Quem tem o papel de orientador vê **Agenda de bancas** no menu. Só o orientador do estagiário marca, remarca ou cancela a banca; os demais professores, servidores e administradores apenas consultam. No passo dos avaliadores, o orientador pode marcar **Convidar o supervisor**: o supervisor do estagiário recebe o convite (como participante opcional no `banca.ics`), mas não é avaliador. A escolha fica em `bancas.convidar_supervisor` (migração `028_banca_convite_supervisor.sql`).

## Avisos e convites da banca

Ao agendar, remarcar ou cancelar uma banca, o sistema envia um e-mail ao orientador, aos dois avaliadores e ao estudante, com um convite de calendário (`banca.ics`) anexado. Gmail/Google Agenda, Outlook e Apple Mail oferecem "Adicionar à agenda"; remarcar atualiza o mesmo evento e cancelar o remove. Quem é substituído na banca recebe o cancelamento. O envio usa o mesmo SMTP do relatório semanal (`SMTP_*` e `APP_URL`); se o e-mail falhar, o agendamento é mantido e a tela avisa que os participantes não foram notificados.

Cada pessoa escolhe em **Meu perfil → E-mails da plataforma** o que quer receber: avisos de banca (todos), resumo semanal (professores) e lembretes de atividades (estudantes). Quem desativa os avisos de banca fica fora do e-mail e do convite, mas continua vendo a banca no sistema. As preferências ficam em `usuarios.receber_email_bancas` e `usuarios.receber_lembretes_atividades` (migração `025_preferencias_email.sql`), ligadas por padrão.

No painel do professor, o cartão **Suas próximas bancas** lista as bancas em que ele é orientador ou avaliador, e a agenda tem o filtro **Somente as minhas**.

## Avaliação do supervisor (FAC)

Após o estudante cumprir as horas, o supervisor vinculado acessa **Fichas → Avaliações dos meus supervisionados** ou **Aluno → Fichas → FAC**. O formulário segue o modelo `docs/Ficha-de-Avaliacao-do-Estagiario-pela-Concedente.pdf`: dados do estágio (empresa/entidade com até 60 caracteres e período com até 35), curso, dez critérios de 0 a 10 com até duas casas decimais, atividades e comentários (até 300 caracteres cada), local e data. A média é calculada com uma casa decimal e usada automaticamente na ata; a nota manual continua disponível para fichas em papel quando não há FAC salva.

Somente o supervisor vinculado pode alterar a FAC, enquanto o estágio estiver aberto, não arquivado e a ata da banca não tiver sido emitida. O aluno pode baixar sua própria ficha; orientador e administrador podem consultá-la e emitir o PDF. Após o encerramento, a ficha fica disponível para consulta/impressão. O PDF preserva os campos para assinaturas e ciência, e textos extensos continuam em anexo. A nota da FAC na ata encerrada mantém o valor salvo no encerramento.

Aplicar a migração `017_ficha_supervisor.sql`. O modelo PDF deve acompanhar a versão implantada. O agendamento da banca permanece como melhoria futura em [docs/atualizacoes-futuras.md](docs/atualizacoes-futuras.md).

## Privacidade (LGPD)

A página pública `/privacidade` explica quais dados pessoais o sistema trata, para quê, com quem são compartilhados, por quanto tempo ficam guardados e como exercer os direitos da LGPD. Ela é acessível pelo rodapé de todas as telas e por uma linha discreta sob o botão de login.

Não há banner de consentimento de cookies: o sistema usa só o cookie de sessão (`connect.sid`, essencial, criado no login) e guarda a preferência de alto contraste no próprio navegador. Se um dia forem adicionados cookies de análise de audiência ou de terceiros, será preciso pedir consentimento antes de ativá-los e atualizar a página.

Antes de publicar uma mudança no tratamento de dados, atualize a página e a data de "Última atualização" em `src/views/privacidade.ejs`.

## Testes

Execute `npm ci` e `npm test`. Os testes usam PostgreSQL embarcado (PGlite) isolado em memória para validar migrações, prazo e intervalo dos lembretes, atualização de atividades, permissões HTTP, persistência da FAC, cálculo da ata e geração de PDF. O transporte de e-mail é substituído nos testes; nenhum e-mail real é enviado. Há também testes de preferência de tema e do resumo semanal existente.

No GitHub Actions, o workflow `testes.yml` roda `npm ci` e `npm test` (Node 25, a mesma versão da imagem de produção). O workflow `deploy.yml` só solicita o deploy ao Dokploy depois que os testes passam. Em pull requests, os testes rodam sozinhos, para conferir antes de juntar na `main`.
