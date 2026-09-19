import { PrismaClient } from '@prisma/client'

import { provisionTenant } from './lib/tenant-provisioning'

const prisma = new PrismaClient()

/**
 * Datos de DEMO para desarrollo local. Corre solo con `npm run prisma:seed` y
 * al final de `npm run prisma:migrate:reset`.
 *
 * Crea una inmobiliaria ficticia con un admin de credenciales conocidas, para
 * que cualquiera pueda levantar el proyecto y loguearse sin configurar nada.
 * Por eso se niega a correr en producción: una contraseña publicada en el
 * repo no puede llegar nunca a un entorno real.
 *
 * Los clientes reales NO se crean acá: `npm run tenant:create` (ver
 * docs/MULTI-TENANCY.md).
 */
const DEMO_TENANT = {
  name: 'Inmobiliaria Demo',
  slug: 'demo',
  adminEmail: 'admin@demo.local',
  adminPassword: 'demo-admin-1234',
} as const

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ El seed de demo no corre con NODE_ENV=production.')
    process.exit(1)
  }

  const existing = await prisma.tenant.findUnique({
    where: { slug: DEMO_TENANT.slug },
  })
  if (existing) {
    console.log('ℹ️  La inmobiliaria demo ya existe. No se modificó nada.')
    return
  }

  await provisionTenant(prisma, {
    ...DEMO_TENANT,
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 12),
  })

  console.log(`✅ Inmobiliaria demo creada.
   Login: ${DEMO_TENANT.adminEmail} / ${DEMO_TENANT.adminPassword}`)
}

main()
  .catch((error) => {
    console.error('❌ Falló el seed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
