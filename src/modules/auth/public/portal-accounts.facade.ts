import { Injectable } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import { PortalRole } from '../domain/enums/role.enum'
import { DomainErrorKind, DomainException } from '@/shared/errors'
import { RefreshTokenRepository } from '../domain/repositories/refresh-token.repository'
import { UserRepository } from '../domain/repositories/user.repository'
import { PasswordService } from '../infrastructure/services/password.service'

/** Ya hay un acceso de portal con ese email en la inmobiliaria, de otra persona. */
export class PortalEmailTakenException extends DomainException {
  constructor() {
    super(
      'PORTAL_EMAIL_TAKEN',
      'Ya hay otro acceso al portal con ese email en la inmobiliaria',
      DomainErrorKind.Conflict,
    )
  }
}

export interface PortalCredentials {
  userId: string
  /** El usuario del portal es el email (D-16). */
  email: string
  /** En claro, una sola vez: no se guarda ni se puede recuperar. */
  password: string
}

/**
 * Accesos al portal de propietarios e inquilinos (Fases 7 y 8). Los usuarios
 * de portal son del módulo de auth (D-16); los módulos de propietarios e
 * inquilinos los crean y resetean por acá, sin tocar la tabla `users`.
 *
 * Corre dentro del tenant del contexto.
 */
@Injectable()
export class PortalAccountsFacade {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Crea el acceso, o si ya existe (`userId`), le pone una contraseña nueva:
   * la anterior deja de servir y se cierran sus sesiones (spec Fase 7, 6).
   * También actualiza email y nombre, por si cambiaron en la ficha.
   */
  async issue(input: {
    role: PortalRole
    email: string
    firstName: string
    lastName: string
    userId: string | null
  }): Promise<PortalCredentials> {
    const email = input.email.trim().toLowerCase()
    const holder = await this.users.findPortalUser(email, input.role)
    if (holder && holder.id !== input.userId) {
      throw new PortalEmailTakenException()
    }

    const password = generatePassword()
    const passwordHash = await this.passwords.hash(password)

    const existing = input.userId
      ? await this.users.findById(input.userId)
      : null

    if (existing) {
      await this.users.update(existing.id, {
        email,
        firstName: input.firstName,
        lastName: input.lastName,
      })
      await this.users.changePassword(existing.id, passwordHash)
      await this.users.setActive(existing.id, true)
      await this.refreshTokens.revokeAllForUser(existing.id)
      return { userId: existing.id, email, password }
    }

    const created = await this.users.create({
      email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
    })
    return { userId: created.id, email, password }
  }

  /** Corta el acceso (al borrar la ficha): desactiva y cierra sesiones. */
  async disable(userId: string): Promise<void> {
    if (!(await this.users.findById(userId))) return
    await this.users.setActive(userId, false)
    await this.refreshTokens.revokeAllForUser(userId)
  }
}

/**
 * 12 bytes aleatorios en base64url: 16 caracteres, sin ambigüedad de
 * codificación en un mail o un WhatsApp.
 */
function generatePassword(): string {
  return randomBytes(12).toString('base64url')
}
