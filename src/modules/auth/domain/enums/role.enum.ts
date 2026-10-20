/**
 * Roles de la aplicación.
 *
 * Se declara acá y no se importa de `@prisma/client` para que el dominio y los
 * controllers no dependan del ORM. Los valores tienen que coincidir con el enum
 * `Role` de `prisma/schema.prisma`.
 *
 * - `ADMIN` y `EMPLOYEE`: operan el backoffice de su inmobiliaria.
 * - `OWNER` y `RENTER`: entran a su portal y sólo ven sus propios datos.
 */
export enum Role {
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE',
  OWNER = 'OWNER',
  RENTER = 'RENTER',
}

export const ALL_ROLES = Object.values(Role)

/** Entran al backoffice con `POST /auth/login` (email único en todo el sistema). */
export const INTERNAL_ROLES = [Role.ADMIN, Role.EMPLOYEE] as const
export type InternalRole = (typeof INTERNAL_ROLES)[number]

/**
 * Entran al portal con `POST /auth/portal-login`, que además pide la
 * inmobiliaria: su email es único dentro de ella, no en todo el sistema.
 */
export const PORTAL_ROLES = [Role.OWNER, Role.RENTER] as const
export type PortalRole = (typeof PORTAL_ROLES)[number]

export function isInternalRole(role: Role): role is InternalRole {
  return (INTERNAL_ROLES as readonly Role[]).includes(role)
}

/**
 * Tipo de usuario del claim `userType` del access token (spec Fase 4, 4).
 * Se deriva del rol: no es un dato aparte que pueda contradecirlo.
 */
export enum UserType {
  INTERNAL = 'internal',
  OWNER = 'owner',
  RENTER = 'renter',
}

export function userTypeOf(role: Role): UserType {
  if (role === Role.OWNER) return UserType.OWNER
  if (role === Role.RENTER) return UserType.RENTER
  return UserType.INTERNAL
}
