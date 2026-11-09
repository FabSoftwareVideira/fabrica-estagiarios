# Fábrica Template Node.js + Express + PostgreSQL

Template padrão para aplicações Node.js + Express + PostgreSQL com CI/CD via GitHub Actions. Use esse repositório como base para seus projetos, adaptando as rotas, lógica e banco conforme necessário. Siga as instruções abaixo:

> **Nota**: Este template está pronto para ser usado em produção no servidor da Fábrica de Software do IFC Campus Videira.

## Stack

- **Runtime**: Node.js 25
- **Framework**: Express
- **Banco**: PostgreSQL 18.3
- **Container**: Docker (multi-stage: dev + prod)
- **CI/CD**: GitHub Actions → self-hosted runner

## Início rápido

```bash
# 1. Copiar variáveis de ambiente
cp .env.sample .env
# Edite .env com suas credenciais

# 2. Subir em modo dev (com hot reload)
docker compose up -d --build

# 3. Acessar
open http://localhost:3000
```

No modo de desenvolvimento, o Docker Compose inicia o Mailpit. Os e-mails enviados pela aplicação são capturados localmente e podem ser vistos em [http://localhost:8025](http://localhost:8025); o serviço SMTP fica acessível apenas pela rede interna do Compose. Os parâmetros do Mailpit vêm das variáveis `DEV_SMTP_*` no `.env` (com padrão seguro `mailpit:1025`) e sobrescrevem as variáveis `SMTP_*`, então credenciais SMTP reais já existentes no `.env` não serão usadas pelo container de desenvolvimento. Mantenha `DEV_SMTP_HOST=mailpit` para que os e-mails de teste não sejam enviados a destinatários reais.

Para preencher o banco de desenvolvimento com dados fictícios, execute `docker compose exec -T estagiarios-web npm run seed:dev`. O seed idempotente cria 12 estudantes vinculados a três supervisores, um supervisor externo aprovado e três orientadores, além de atividades de exemplo. Na tela de login, abra **Acessos de desenvolvimento** para entrar como estudante (`estudante04@example.test`), supervisor (`supervisora1@example.test`), supervisor externo (`supervisor.externo@example.test`) ou orientador (`orientador1@example.test`). O supervisor externo de teste acompanha os três primeiros estudantes. Essas contas só autenticam em desenvolvimento; os endereços `.test` são fictícios.

Ao aprovar o cadastro do estudante, informe os dias e o horário contínuo planejado para cada dia (até 6 horas). A escala é mostrada no calendário e no formulário de atividades como referência, mas não limita os registros: o estudante pode registrar atividades em qualquer dia, exceto domingo, respeitando o limite de 6 horas por dia.

Todos usam os mesmos botões Google ou GitHub na página inicial. No primeiro acesso com e-mail fora de `@ifc.edu.br`, a pessoa escolhe entre continuar como estudante ou solicitar perfil de supervisor externo; o pedido coleta empresa e função e aguarda aprovação de um professor. Depois da aprovação, o professor pode vincular o supervisor a estudantes; ele verá apenas esses estudantes e poderá validar atividades e preencher a FAC, sem acesso às funções de orientador ou administrador. As migrações `019_supervisor_externo.sql` e `020_dados_supervisor_externo.sql` são aplicadas automaticamente no modo de desenvolvimento e no deploy.

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

O workflow `.github/workflows/relatorio-semanal.yml` verifica a programação a cada 15 minutos, e o script envia no dia/horário configurados pelo administrador (fuso `America/Sao_Paulo`). O envio manual ignora a programação automática, mas respeita as preferências dos professores. Em ambos os casos, sai uma única mensagem para o endereço SMTP configurado, com os supervisores elegíveis em cópia oculta (BCC). O conteúdo é consolidado e agrupa os estudantes por supervisor. O resumo mostra as horas registradas e as atividades preenchidas nos últimos 7 dias; as horas incluem atividades pendentes de validação e excluem atividades invalidadas. Cada aluno tem um link para os detalhes na aplicação.

O workflow de deploy aplica automaticamente as migrações pendentes em ordem, usando `src/scripts/runMigrations.js`, antes de atualizar o container web. O histórico fica registrado na tabela `schema_migrations`. Na primeira execução em bancos legados, o runner verifica se o schema já está no estado esperado até a migração 010 e registra esse baseline; caso não esteja, o deploy para com uma mensagem de erro em vez de presumir e pular migrações antigas. Em instalações novas, `db/init.sql` cria a estrutura atual e o runner aplica e registra as migrações recentes de forma idempotente.

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

`SMTP_FROM` é opcional e, se omitido, usa `SMTP_USER` como remetente. O workflow roda no runner self-hosted já usado pelo deploy e executa o script dentro do container web. Também é possível iniciá-lo manualmente em **GitHub Actions → Relatório semanal dos orientadores → Run workflow**. Os e-mails são enviados após a implantação da nova versão da aplicação.

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
│       └── deploy.yml          # Deploy no servidor
├── Dockerfile                  # Multi-stage: dev | deps | prod
├── docker-compose.dev.yml
├── docker-compose.prod.yml
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
   - `name` em `docker-compose.prod.yml`
2. Atualize `PROJECT_NAME` em `deploy.yml`
3. Configure os secrets no GitHub:
   - `ENV_FILE` — conteúdo do `.env` de produção

---

## Rollback

Via GitHub Actions → **Continuous Deployment** → **Run workflow** → informe a tag (ex: `v0.1.5`).

Ou direto no servidor:

```bash
sed -i 's/^APP_VERSION=.*/APP_VERSION=v0.1.5/' .env
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Encerramento do estágio e ata da banca (FARE)

- O orientador abre **Fichas** no menu, preenche a FAPO e a ata da banca (média da FAC salva pelo supervisor, ou nota da ficha em papel, notas N1/N2/N3 de cada critério, avaliadores, resultado e comentários).
- A nota final é a soma de (nota x peso) dividida por 10. A FAA vem da ficha do aluno (ou é digitada se o aluno não preencheu) e a FAPO vem da ficha salva.
- Ao **concluir o estágio** (`alunos.encerrado_em`), o aluno não registra mais atividades nem altera a FAA, e o supervisor não valida mais horas: só é possível consultar e imprimir. O orientador (ou admin) pode **reabrir** o estágio.
- Migração: `db/migrations/014_ata_banca.sql` (coluna `encerrado_em` e tabela `fares`). O modelo do PDF fica em `docs/FARE - Avaliação-Estágio-Ata-Banca-.pdf`.

## Lembretes de atividades para estudantes (suspensos)

O workflow automático dos lembretes foi removido temporariamente. Não há execução agendada desse recurso nesta versão. O script, a migração e os testes foram preservados para retomada posterior; o resumo semanal dos supervisores continua com seu fluxo existente. O motivo da suspensão e os pré-requisitos para retomada estão em [docs/lembretes-suspensos.md](docs/lembretes-suspensos.md).

A implementação preservada identifica estudantes com estágio em andamento, não arquivado e não encerrado que passam **mais de 5 dias completos** sem registrar ou atualizar atividades. Ela reutiliza o serviço SMTP e as variáveis `APP_URL`/`SMTP_*` existentes.

O prazo considera a data do registro/alteração, mesmo para atividades retroativas. Validações do supervisor não reiniciam a contagem. Para alunos sem atividades, considera-se o cadastro; ao sair da lista de espera ou desarquivar um estágio em andamento, o prazo recomeça. Na migração de dados existentes, usa-se o registro mais recente disponível (ou a criação do aluno); não há histórico de edições anterior à migração.

Cada estudante recebe no máximo um lembrete a cada **7 dias**, enquanto continuar elegível. A mensagem inclui nome, matrícula, empresa, supervisor, orientador e carga horária conforme disponíveis, além do link para registrar atividades e horas. Um lock no PostgreSQL impede execuções simultâneas. O intervalo é reservado antes do SMTP para evitar duplicação se o processo parar após a aceitação; em falhas explícitas de SMTP, a tentativa é adiada por uma hora. Uma interrupção durante o envio pode adiar esse lembrete até a próxima janela de sete dias.

A migração `016_lembretes_atividades.sql` permanece no histórico de deploy e não envia e-mails. O comando manual `npm run email:reminders` também permanece no código, mas **envia e-mails reais** usando o SMTP configurado; não deve ser executado em produção durante a suspensão. A retomada do envio automático exige recriar o workflow somente após implantar o script e aplicar a migração no servidor.

## Temas claro e escuro

O ícone de sol/lua no cabeçalho alterna o tema em todas as páginas, inclusive no celular e na página pública. Sem escolha salva, a interface acompanha `prefers-color-scheme`, inclusive mudanças durante a visita. A escolha manual é salva em `localStorage` e tem prioridade nas próximas visitas. O alto contraste continua disponível e tem prioridade visual. Para voltar ao comportamento automático, remova a chave `tema` do armazenamento local do navegador.

## Avaliação do supervisor (FAC)

Após o estudante cumprir as horas, o supervisor vinculado acessa **Fichas → Avaliações dos meus supervisionados** ou **Aluno → Documentos → FAC**. O formulário segue o modelo `docs/Ficha-de-Avaliacao-do-Estagiario-pela-Concedente.pdf`: dados do estágio, curso, período, dez critérios de 0 a 10, atividades, comentários, local e data. A média é calculada com uma casa decimal e usada automaticamente na ata; a nota manual continua disponível para fichas em papel quando não há FAC salva.

Somente o supervisor vinculado pode alterar a FAC, enquanto o estágio estiver aberto e não arquivado. O aluno pode baixar sua própria ficha; orientador e administrador podem consultá-la e emitir o PDF. Após o encerramento, a ficha fica disponível para consulta/impressão. O PDF preserva os campos para assinaturas e ciência, e textos extensos continuam em anexo. A nota da FAC na ata encerrada mantém o valor salvo no encerramento.

Aplicar a migração `017_ficha_supervisor.sql`. O modelo PDF deve acompanhar a versão implantada. O agendamento da banca permanece como melhoria futura em [docs/atualizacoes-futuras.md](docs/atualizacoes-futuras.md).

## Testes

Execute `npm ci` e `npm test`. Os testes usam PostgreSQL embarcado (PGlite) isolado em memória para validar migrações, prazo e intervalo dos lembretes, atualização de atividades, permissões HTTP, persistência da FAC, cálculo da ata e geração de PDF. O transporte de e-mail é substituído nos testes; nenhum e-mail real é enviado. Há também testes de preferência de tema e do resumo semanal existente.
