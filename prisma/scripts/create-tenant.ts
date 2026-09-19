import { PrismaClient } from '@prisma/client'
import { parseArgs } from 'node:util'

import { ProvisioningError, provisionTenant } from '../lib/tenant-provisioning'

const USAGE = `
Alta de una inmobiliaria (cliente del SaaS) con su primer administrador.

  npm run tenant:create -- --name "Oppido Propiedades" --slug oppido --admin-email admin@oppido.com.ar

  --name          Nombre de la inmobiliaria (obligatorio)
  --slug          Identificador corto y único: minúsculas, números y guiones (obligatorio)
  --admin-email   Email del primer administrador (obligatorio)
  --admin-name    Nombre del administrador (opcional, default "Admin")

La contraseña del administrador se genera acá y se muestra UNA sola vez. No se
pasa por parámetro a propósito: quedaría en el historial de la terminal. El
administrador la cambia después desde la app (POST /auth/change-password).

Corre contra la base del config de Doppler de esta carpeta (dev_backend en local).
`

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      slug: { type: 'string' },
      'admin-email': { type: 'string' },
      'admin-name': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help || !values.name || !values.slug || !values['admin-email']) {
    console.log(USAGE)
    process.exit(values.help ? 0 : 1)
  }

  const prisma = new PrismaClient()
  try {
    const result = await provisionTenant(prisma, {
      name: values.name,
      slug: values.slug,
      adminEmail: values['admin-email'],
      adminFirstName: values['admin-name'],
      bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 12),
    })

    console.log(`
✅ Inmobiliaria creada
   Nombre:  ${values.name}
   Slug:    ${result.slug}
   Id:      ${result.tenantId}

✅ Administrador creado
   Email:       ${result.adminEmail}
   Contraseña:  ${result.generatedPassword}

⚠️  Guardá la contraseña ahora: no se vuelve a mostrar ni se puede recuperar.
    Pedile al administrador que la cambie en su primer ingreso.
`)
  } catch (error) {
    if (error instanceof ProvisioningError) {
      console.error(`❌ ${error.message}`)
      process.exit(1)
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('❌ Falló el alta:', error)
  process.exit(1)
})
