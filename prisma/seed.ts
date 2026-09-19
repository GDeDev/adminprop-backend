import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

/** Mismo formato que acepta el campo `slug`: minúsculas, números y guiones. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Seed inicial: crea una inmobiliaria (tenant) y su administrador.
 *
 * Nada de esto está hardcodeado: el SaaS no sabe quién es su primer cliente.
 * Todo sale del entorno (Doppler, config `dev_backend` en local):
 *
 *   SEED_TENANT_NAME     nombre de la inmobiliaria
 *   SEED_TENANT_SLUG     identificador corto y único ("mi-inmobiliaria")
 *   SEED_ADMIN_EMAIL     email del administrador
 *   SEED_ADMIN_PASSWORD  contraseña inicial (10+ caracteres)
 *
 *   npm run prisma:seed
 *
 * Es idempotente: si el tenant ya existe (por slug) se reutiliza, y si el email
 * ya existe no se toca nada. Para sumar otra inmobiliaria alcanza con volver a
 * correrlo con otros valores.
 */
async function main() {
  const tenantName = process.env.SEED_TENANT_NAME?.trim()
  const tenantSlug = process.env.SEED_TENANT_SLUG?.trim().toLowerCase()
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD

  const missing = [
    ['SEED_TENANT_NAME', tenantName],
    ['SEED_TENANT_SLUG', tenantSlug],
    ['SEED_ADMIN_EMAIL', email],
    ['SEED_ADMIN_PASSWORD', password],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0 || !tenantName || !tenantSlug || !email || !password) {
    console.error(
      `❌ Faltan variables: ${missing.join(', ')}.\n` +
        '   Cargalas en Doppler (config dev_backend) y corré npm run prisma:seed.',
    )
    process.exit(1)
  }

  if (!SLUG_PATTERN.test(tenantSlug)) {
    console.error(
      '❌ SEED_TENANT_SLUG sólo admite minúsculas, números y guiones.',
    )
    process.exit(1)
  }

  if (password.length < 10) {
    console.error('❌ SEED_ADMIN_PASSWORD debe tener al menos 10 caracteres.')
    process.exit(1)
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: {},
    create: { name: tenantName, slug: tenantSlug },
  })

  console.log(`✅ Tenant: ${tenant.name} (${tenant.slug}, id: ${tenant.id})`)

  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing) {
    console.log(`ℹ️  El usuario ${email} ya existe. No se modificó nada.`)
    return
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12)
  const passwordHash = await bcrypt.hash(password, saltRounds)

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email,
      passwordHash,
      firstName: process.env.SEED_ADMIN_FIRST_NAME ?? 'Admin',
      lastName: process.env.SEED_ADMIN_LAST_NAME ?? null,
      role: Role.ADMIN,
    },
  })

  console.log(`✅ Administrador creado: ${admin.email} (id: ${admin.id})`)
}

main()
  .catch((error) => {
    console.error('❌ Falló el seed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
