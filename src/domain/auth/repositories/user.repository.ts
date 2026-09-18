import { User } from '../entities/user.entity'
import { Role } from '../enums/role.enum'

export interface CreateUserData {
  email: string
  passwordHash: string
  firstName?: string | null
  lastName?: string | null
  role?: Role
}

/**
 * Puerto del repositorio de usuarios.
 *
 * Es una clase abstracta y no una interface para poder usarla como token de
 * inyección de NestJS (las interfaces de TypeScript no existen en runtime).
 */
export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>

  /** La búsqueda por email es case-insensitive: el email se guarda normalizado. */
  abstract findByEmail(email: string): Promise<User | null>

  abstract existsByEmail(email: string): Promise<boolean>

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
