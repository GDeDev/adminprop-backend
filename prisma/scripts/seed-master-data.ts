import { PrismaClient } from '@prisma/client'

import { seedBaseMasterData } from '../lib/master-data-seed'

/**
 * Completa el catálogo base de maestros en las inmobiliarias que ya existían
 * antes de la Fase 5 (las nuevas lo reciben al darse de alta).
 *
 *   npm run master-data:seed                  # todas
 *   npm run master-data:seed -- --slug oppido # una
 *
 * Idempotente: sólo agrega lo que falta. Se puede correr las veces que haga
 * falta, también en producción.
 */
const prisma = new PrismaClient()

async function main() {
  const slugIndex = process.argv.indexOf('--slug')
  const slug = slugIndex >= 0 ? process.argv[slugIndex + 1] : undefined

  const tenants = await prisma.tenant.findMany({
    where: slug ? { slug } : {},
    select: { id: true, slug: true },
    orderBy: { slug: 'asc' },
  })

  if (tenants.length === 0) {
    console.error(
      slug
        ? `❌ No existe la inmobiliaria "${slug}".`
        : 'ℹ️  No hay inmobiliarias.',
    )
    process.exitCode = slug ? 1 : 0
    return
  }

  for (const tenant of tenants) {
    const { created } = await seedBaseMasterData(prisma, tenant.id)
    console.log(
      created > 0
        ? `✅ ${tenant.slug}: ${created} maestros agregados`
        : `ℹ️  ${tenant.slug}: ya tenía el catálogo base`,
    )
  }
}

main()
  .catch((error) => {
    console.error('❌ Falló la carga de maestros:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
