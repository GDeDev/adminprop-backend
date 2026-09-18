import 'dotenv/config'
import { defineConfig } from 'prisma/config'

/**
 * Configuración del CLI de Prisma.
 *
 * Reemplaza a la clave `prisma` de package.json, deprecada desde Prisma 6 y
 * eliminada en Prisma 7.
 *
 * El `import 'dotenv/config'` de arriba es necesario: el CLI de Prisma ya no
 * lee los archivos .env por su cuenta cuando existe este archivo.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'ts-node -r tsconfig-paths/register prisma/seed.ts',
  },
})
