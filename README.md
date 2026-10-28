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

O administrador configura o envio em **Administração → Relatório semanal por e-mail**. É possível habilitar/desabilitar e escolher o dia e horário, ou usar **Enviar resumo agora**. A tela lista os orientadores com estudantes ativos e quantos alunos cada um possui. Cada professor pode desativar o recebimento no próprio perfil. O envio automático começa desabilitado.

O workflow `.github/workflows/relatorio-semanal.yml` verifica a programação a cada 15 minutos, e o script envia no dia/horário configurados pelo administrador (fuso `America/Sao_Paulo`). O envio manual ignora a programação automática, mas respeita as preferências dos professores. Em ambos os casos, sai uma única mensagem para o endereço SMTP configurado, com os professores elegíveis em cópia oculta (BCC). O conteúdo é consolidado e inclui os estudantes de todos esses professores. O resumo mostra as horas registradas e as atividades preenchidas nos últimos 7 dias; as horas incluem atividades pendentes de validação e excluem atividades invalidadas. Cada aluno tem um link para os detalhes na aplicação.

Em bancos existentes, aplique as migrações antes de usar os recursos de relatório. Execute na VPS, a partir da pasta do projeto, na ordem:

```bash
docker exec -i fabrica-estagiarios-db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/migrations/011_relatorio_semanal_config.sql
docker exec -i fabrica-estagiarios-db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/migrations/012_preferencia_email_professor.sql
```

Em desenvolvimento, use o container `fabrica-estagiarios-dev-db` no lugar de `fabrica-estagiarios-db`.

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
