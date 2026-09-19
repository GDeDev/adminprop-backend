import { defineConfig } from 'prisma/config'

/**
 * Configuración del CLI de Prisma.
 *
 * Reemplaza a la clave `prisma` de package.json, deprecada desde Prisma 6 y
 * eliminada en Prisma 7.
 *
 * No carga ningún `.env`: las variables (`DATABASE_URL` incluida) las inyecta
 * Doppler. Por eso los scripts `prisma:*` de package.json corren dentro de
 * `doppler run --`.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'ts-node -r tsconfig-paths/register prisma/seed.ts',
  },
})
