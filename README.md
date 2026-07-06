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
cp .env.example .env
# Edite .env com suas credenciais

# 2. Subir em modo dev (com hot reload)
docker compose up -d --build

# 3. Acessar
open http://localhost:3000
```

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

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Página inicial (HTML) |
| GET | `/health` | Health check com status do banco |
| GET | `/api/hello` | Exemplo de rota com query no banco |

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