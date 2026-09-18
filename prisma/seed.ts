import { PrismaClient, Role } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

/**
 * Seed inicial: crea el usuario administrador.
 *
 * La contraseña **no** está hardcodeada a propósito: se pasa por
 * `SEED_ADMIN_PASSWORD`. Un template con una contraseña de admin conocida es
 * exactamente el tipo de cosa que después aparece en producción.
 *
 *   SEED_ADMIN_EMAIL=admin@tuempresa.com \
 *   SEED_ADMIN_PASSWORD='...' \
 *   npm run prisma:seed
 */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD

  if (!email || !password) {
    console.error(
      '❌ Faltan SEED_ADMIN_EMAIL y/o SEED_ADMIN_PASSWORD.\n' +
        '   Generá una contraseña fuerte con: openssl rand -base64 24',
    )
    process.exit(1)
  }

  if (password.length < 10) {
    console.error('❌ SEED_ADMIN_PASSWORD debe tener al menos 10 caracteres.')
    process.exit(1)
  }

  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing) {
    console.log(`ℹ️  El usuario ${email} ya existe. No se modificó nada.`)
    return
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12)
  const passwordHash = await bcrypt.hash(password, saltRounds)

  const admin = await prisma.user.create({
    data: {
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
