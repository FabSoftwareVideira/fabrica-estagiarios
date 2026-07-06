# ─── base ────────────────────────────────────────────────────────────────────
FROM node:25-alpine AS base
WORKDIR /app
COPY package*.json ./

# ─── dev ─────────────────────────────────────────────────────────────────────
FROM base AS dev
ENV NODE_ENV=development
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ─── deps (apenas prod) ───────────────────────────────────────────────────────
FROM base AS deps
RUN npm ci --omit=dev

# ─── prod ─────────────────────────────────────────────────────────────────────
FROM node:25-alpine AS prod
ARG APP_VERSION=dev
ARG APP_ENV=production
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    APP_ENV=${APP_ENV}

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Usuário não-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000
CMD ["node", "src/server.js"]