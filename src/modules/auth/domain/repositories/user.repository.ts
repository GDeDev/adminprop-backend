import { User } from '../entities/user.entity'
import { PortalRole, Role } from '../enums/role.enum'

/** El tenant no se pasa: es el del contexto (lo completa el filtro de tenant). */
export interface CreateUserData {
  email: string
  passwordHash: string
  firstName?: string | null
  lastName?: string | null
  role: Role
}

/**
 * Puerto del repositorio de usuarios.
 *
 * Es una clase abstracta y no una interface para poder usarla como token de
 * inyección de NestJS (las interfaces de TypeScript no existen en runtime).
 */
export abstract class UserRepository {
  /** Busca dentro del tenant del contexto. */
  abstract findById(id: string): Promise<User | null>

  /**
   * Busca un usuario **interno** (admin o empleado) en **todos** los tenants:
   * el login del backoffice todavía no sabe a qué inmobiliaria pertenece y lo
   * averigua con esto. Entre internos, el email es único global.
   * La búsqueda es case-insensitive: el email se guarda normalizado.
   */
  abstract findInternalByEmail(email: string): Promise<User | null>

  /**
   * Busca un usuario de portal (propietario o inquilino) dentro del tenant del
   * contexto. Su email es único por inmobiliaria y rol: la misma persona puede
   * ser propietaria en dos inmobiliarias, o propietaria e inquilina en una.
   */
  abstract findPortalUser(email: string, role: PortalRole): Promise<User | null>

  /**
   * Busca por id en **todos** los tenants. Sólo para retomar una sesión desde
   * un refresh token, que no lleva el tenant.
   */
  abstract findByIdForSession(id: string): Promise<User | null>

  /**
   * Si hay un usuario interno con ese email, en cualquier tenant (global, como
   * el índice único). `exceptId` excluye al propio usuario al editarlo.
   */
  abstract existsInternalByEmail(
    email: string,
    exceptId?: string,
  ): Promise<boolean>

  abstract create(data: CreateUserData): Promise<User>

  /**
   * Cambia la contraseña. Sella `passwordChangedAt`, lo que invalida los access
   * tokens emitidos antes (cuando `JWT_VALIDATE_USER_ON_REQUEST` está activo).
   */
  abstract changePassword(userId: string, passwordHash: string): Promise<void>

  /**
   * Reemplaza el hash sin tocar `passwordChangedAt`.
   *
   * Es para el re-hash silencioso cuando subís el costo de bcrypt: la
   * contraseña no cambió, así que no hay razón para tirar abajo las sesiones
   * abiertas en otros dispositivos.
   */
  abstract rehashPassword(userId: string, passwordHash: string): Promise<void>

  /** Suma un intento fallido y bloquea la cuenta si se pasa del umbral. */
  abstract registerFailedLogin(
    userId: string,
    maxAttempts: number,
    lockDurationMs: number,
  ): Promise<void>

  /** Resetea el contador de fallos y sella `lastLoginAt`. */
  abstract registerSuccessfulLogin(userId: string): Promise<void>
}
