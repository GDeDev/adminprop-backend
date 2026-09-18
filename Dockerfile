# Imagen base
FROM node:22-alpine AS base
RUN apk add --no-cache dumb-init

# Etapa de build
FROM base AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --no-audit --no-fund

COPY . .

# Genera el cliente de Prisma, compila y saca las devDependencies
RUN npx prisma generate && \
  npm run build && \
  npm prune --omit=dev

# Imagen final
FROM base AS runner
WORKDIR /app

# Usuario sin privilegios
RUN addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 --ingroup nodejs nestjs

COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma/

USER nestjs

EXPOSE 3000

ENV NODE_ENV=production \
  PORT=3000

# /health es VERSION_NEUTRAL: no lleva el prefijo /api/v1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# dumb-init como PID 1 para que SIGTERM llegue a Node y corran los shutdown
# hooks (cerrar Prisma, terminar requests en vuelo) en vez de un kill seco.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main"]
