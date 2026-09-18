import { Role } from '../enums/role.enum'

/**
 * Usuario tal como lo ve el dominio.
 *
 * `passwordHash` está incluido a propósito: los handlers lo necesitan para
 * verificar credenciales. Nunca se devuelve por HTTP — para eso está
 * `toPublicUser()`.
 */
export interface User {
  id: string
  email: string
  passwordHash: string
  firstName: string | null
  lastName: string | null
  role: Role
  isActive: boolean
  failedLoginAttempts: number
  lockedUntil: Date | null
  lastLoginAt: Date | null
  passwordChangedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Proyección segura del usuario: lo único que sale por la API. */
export interface PublicUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  role: Role
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  }
}

/** ¿La cuenta está bloqueada por intentos fallidos en este momento? */
export function isLocked(user: User, now: Date = new Date()): boolean {
  return user.lockedUntil !== null && user.lockedUntil > now
}
