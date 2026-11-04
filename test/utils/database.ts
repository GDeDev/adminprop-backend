import { PrismaClient, Role } from '@prisma/client'

import { PrismaService } from '../../src/shared/prisma/prisma.service'

/**
 * Un consumidor de la cola que todavía está terminando el trabajo del test
 * anterior puede tomar locks de dos tablas en otro orden que el `TRUNCATE`: el
 * deadlock lo resuelve Postgres abortando una de las dos. El `TRUNCATE` no
 * dejó nada a medias, así que alcanza con repetirlo.
 */
async function withDeadlockRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      const deadlock = String(error).includes('40P01')
      if (!deadlock || attempt >= 5) throw error
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
    }
  }
}

/**
 * Vacía todas las tablas de la app (no la de migraciones).
 *
 * Se llama en el `beforeEach` de cada e2e que usa la base: cada test arranca
 * de cero y no depende del orden en que corren los demás.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `
  if (tables.length === 0) return

  const list = tables.map(({ tablename }) => `"public"."${tablename}"`)
  await withDeadlockRetry(() =>
    prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${list.join(', ')} RESTART IDENTITY CASCADE`,
    ),
  )

  // Los trabajos de pg-boss que quedaron de otros tests apuntan a tenants que
  // ya no existen: fallan, se reintentan y demoran a los trabajos nuevos.
  const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'pgboss' AND table_name = 'job'
    ) AS exists
  `
  if (exists) {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE pgboss.job, pgboss.archive')
  }
}

/**
 * Crea un tenant con los defaults del PRD y un punitorio del 5 % explícito
 * (D-227: el esquema ya no lo trae). Va por el cliente base: no tiene tenant.
 */
export function createTenant(prisma: PrismaService, slug: string) {
  return prisma.tenant.create({
    data: {
      name: `Inmobiliaria ${slug}`,
      slug,
      dailyLateFeePercentage: 5,
    },
  })
}

/**
 * Crea un usuario directo en la base, por el cliente base (sin filtro de
 * tenant ni auditoría): es preparación del escenario, no lo que se prueba.
 */
/** Contraseña de todos los usuarios que crea `createUser`. */
export const TEST_PASSWORD = 'ClaveDePrueba1'

export function createUser(
  prisma: PrismaService,
  data: {
    tenantId: string
    email: string
    passwordHash?: string
    role?: Role
  },
) {
  return prisma.user.create({
    data: {
      tenantId: data.tenantId,
      email: data.email,
      // Hash bcrypt de "ClaveDePrueba1" con costo 10.
      passwordHash:
        data.passwordHash ??
        '$2a$10$1KzNRfEf4UfT7FxXXMv.V.TPPmKO7XPGGfZLpNj2QiVG5tzKRxH1q',
      role: data.role ?? Role.EMPLOYEE,
    },
  })
}
