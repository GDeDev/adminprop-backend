import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'

/** Mismo formato que el campo `slug`: minúsculas, números y guiones. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 10

export interface ProvisionTenantInput {
  name: string
  slug: string
  adminEmail: string
  /** Sin contraseña se genera una temporal, que se devuelve una sola vez. */
  adminPassword?: string
  adminFirstName?: string
  bcryptSaltRounds?: number
}

export interface ProvisionedTenant {
  tenantId: string
  slug: string
  adminId: string
  adminEmail: string
  /** Sólo si se generó acá. Nunca se guarda en claro. */
  generatedPassword?: string
}

/** Un dato de entrada inválido o un duplicado: mensaje para quien corre el script. */
export class ProvisioningError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProvisioningError'
  }
}

/**
 * Da de alta una inmobiliaria con su primer administrador, en una transacción:
 * o quedan los dos, o ninguno.
 *
 * Los clientes del SaaS son filas de `tenants`, no configuración: esta función
 * es la única forma de crearlos mientras no exista una pantalla de alta. La
 * usan `npm run tenant:create` (clientes reales) y el seed (datos de demo).
 *
 * Usa el cliente de Prisma sin extensiones a propósito: todavía no hay tenant
 * en contexto, es justamente lo que se está creando.
 */
export async function provisionTenant(
  prisma: PrismaClient,
  input: ProvisionTenantInput,
): Promise<ProvisionedTenant> {
  const name = input.name.trim()
  const slug = input.slug.trim().toLowerCase()
  const adminEmail = input.adminEmail.trim().toLowerCase()

  if (!name) throw new ProvisioningError('Falta el nombre de la inmobiliaria.')
  if (!SLUG_PATTERN.test(slug)) {
    throw new ProvisioningError(
      `Slug inválido: "${slug}". Sólo minúsculas, números y guiones (ej. "mi-inmobiliaria").`,
    )
  }
  if (!EMAIL_PATTERN.test(adminEmail)) {
    throw new ProvisioningError(`Email inválido: "${adminEmail}".`)
  }
  if (
    input.adminPassword !== undefined &&
    input.adminPassword.length < MIN_PASSWORD_LENGTH
  ) {
    throw new ProvisioningError(
      `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    )
  }

  if (await prisma.tenant.findUnique({ where: { slug } })) {
    throw new ProvisioningError(
      `Ya existe una inmobiliaria con slug "${slug}".`,
    )
  }
  // El email de un usuario interno es único en todo el sistema, no por
  // inmobiliaria (índice parcial users_internal_email_key).
  const taken = await prisma.user.findFirst({
    where: { email: adminEmail, role: { in: [Role.ADMIN, Role.EMPLOYEE] } },
  })
  if (taken) {
    throw new ProvisioningError(`Ya existe un usuario con email ${adminEmail}.`)
  }

  const generatedPassword = input.adminPassword
    ? undefined
    : randomBytes(12).toString('base64url')
  const passwordHash = await bcrypt.hash(
    input.adminPassword ?? (generatedPassword as string),
    input.bcryptSaltRounds ?? 12,
  )

  const { tenant, admin } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name, slug } })
    const admin = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: adminEmail,
        passwordHash,
        firstName: input.adminFirstName ?? 'Admin',
        role: Role.ADMIN,
      },
    })
    return { tenant, admin }
  })

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    adminId: admin.id,
    adminEmail: admin.email,
    generatedPassword,
  }
}
