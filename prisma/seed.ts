import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

import { seedBaseMasterData } from './lib/master-data-seed'
import { provisionTenant } from './lib/tenant-provisioning'

const prisma = new PrismaClient()

/**
 * Datos de DEMO para desarrollo local. Corre solo con `npm run prisma:seed` y
 * al final de `npm run prisma:migrate:reset`.
 *
 * Crea una inmobiliaria ficticia con usuarios de credenciales conocidas, para
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

/**
 * Un usuario por rol además del admin, para probar permisos (un empleado no
 * gestiona usuarios) y los dos portales. Los de portal se loguean con
 * `POST /auth/portal-login` y el slug `demo`.
 */
const DEMO_USERS = [
  {
    email: 'empleado@demo.local',
    password: 'demo-employee-1234',
    firstName: 'Ernesto',
    lastName: 'Empleado',
    role: Role.EMPLOYEE,
  },
  {
    email: 'propietario@demo.local',
    password: 'demo-owner-1234',
    firstName: 'Paula',
    lastName: 'Propietaria',
    role: Role.OWNER,
  },
  {
    email: 'inquilino@demo.local',
    password: 'demo-renter-1234',
    firstName: 'Iván',
    lastName: 'Inquilino',
    role: Role.RENTER,
  },
] as const

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ El seed de demo no corre con NODE_ENV=production.')
    process.exit(1)
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12)

  let tenant = await prisma.tenant.findUnique({
    where: { slug: DEMO_TENANT.slug },
  })
  if (tenant) {
    console.log('ℹ️  La inmobiliaria demo ya existe.')
  } else {
    const provisioned = await provisionTenant(prisma, {
      ...DEMO_TENANT,
      bcryptSaltRounds: saltRounds,
    })
    tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: provisioned.tenantId },
    })
    console.log('✅ Inmobiliaria demo creada.')
  }

  // Se agregan los que falten, así una base sembrada antes de la Fase 4 los
  // recibe sin tener que resetearla.
  for (const demo of DEMO_USERS) {
    const exists = await prisma.user.findFirst({
      where: { tenantId: tenant.id, email: demo.email, role: demo.role },
    })
    if (exists) continue

    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: demo.email,
        passwordHash: await bcrypt.hash(demo.password, saltRounds),
        firstName: demo.firstName,
        lastName: demo.lastName,
        role: demo.role,
      },
    })
    console.log(`✅ Usuario demo creado: ${demo.email}`)
  }

  // Maestros: el catálogo base ya lo cargó el alta; acá se completa una base
  // sembrada antes de la Fase 5 y se suman localidades y barrios de ejemplo.
  const masters = await seedBaseMasterData(prisma, tenant.id, {
    withSampleCities: true,
  })
  if (masters.created > 0) {
    console.log(`✅ Maestros demo: ${masters.created} agregados`)
  }

  console.log(`
   Backoffice:  ${DEMO_TENANT.adminEmail} / ${DEMO_TENANT.adminPassword}
                ${DEMO_USERS[0].email} / ${DEMO_USERS[0].password}
   Portal (inmobiliaria "${DEMO_TENANT.slug}"):
                ${DEMO_USERS[1].email} / ${DEMO_USERS[1].password}  (propietario)
                ${DEMO_USERS[2].email} / ${DEMO_USERS[2].password}  (inquilino)`)
}

main()
  .catch((error) => {
    console.error('❌ Falló el seed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
