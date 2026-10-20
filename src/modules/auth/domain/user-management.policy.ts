import { User } from './entities/user.entity'
import { isInternalRole, Role } from './enums/role.enum'
import {
  CannotChangeOwnRoleException,
  CannotDeactivateSelfException,
  CannotResetOwnPasswordException,
  UserNotFoundException,
} from './exceptions/user-management.exceptions'

/**
 * Reglas de la gestión de usuarios internos: lo que un admin puede hacer sobre
 * los usuarios de su inmobiliaria (spec Fase 4, 3.6).
 *
 * Puras, sin NestJS ni Prisma: los handlers las invocan.
 *
 * Ninguna regla cuenta cuántos admins quedan. No hace falta: el que actúa es
 * siempre un admin activo, y no puede quitarse el rol ni desactivarse a sí
 * mismo, así que la inmobiliaria nunca se queda sin administrador.
 */
export const UserManagementPolicy = {
  /** "  Ana   María " → "Ana María". */
  normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ')
  },

  /**
   * `/users` sólo gestiona admins y empleados. Un propietario o inquilino se
   * gestiona desde su ficha (Fases 7 y 8): acá responde como inexistente.
   */
  requireManageable(user: User | null, id: string): User {
    if (!user || !isInternalRole(user.role)) {
      throw new UserNotFoundException(id)
    }
    return user
  },

  assertCanChangeRole(actorId: string, target: User, newRole: Role): void {
    if (actorId === target.id && newRole !== target.role) {
      throw new CannotChangeOwnRoleException()
    }
  },

  assertCanDeactivate(actorId: string, target: User): void {
    if (actorId === target.id) throw new CannotDeactivateSelfException()
  },

  /**
   * El reseteo por admin no pide la contraseña actual. Sobre uno mismo sería
   * un atajo para quien robó una sesión abierta: para eso está el cambio de
   * contraseña, que sí la pide.
   */
  assertCanResetPassword(actorId: string, target: User): void {
    if (actorId === target.id) throw new CannotResetOwnPasswordException()
  },
}
