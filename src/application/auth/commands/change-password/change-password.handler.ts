import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { AuthErrors } from '@/domain/auth/exceptions/auth.exceptions'
import { RefreshTokenRepository } from '@/domain/auth/repositories/refresh-token.repository'
import { UserRepository } from '@/domain/auth/repositories/user.repository'
import { PasswordService } from '@/infrastructure/auth/services/password.service'
import { CustomLoggerService } from '@/shared/core/logger.service'
import { ChangePasswordCommand } from './change-password.command'

export interface ChangePasswordResult {
  revokedSessions: number
}

/**
 * Cambia la contraseña del usuario autenticado.
 *
 * Al terminar revoca **todas** las sesiones, incluida la actual: si la
 * contraseña se cambió porque se filtró, dejar sesiones vivas no tendría
 * sentido. El cliente tiene que volver a loguearse.
 */
@CommandHandler(ChangePasswordCommand)
export class ChangePasswordHandler implements ICommandHandler<
  ChangePasswordCommand,
  ChangePasswordResult
> {
  private readonly logger = new CustomLoggerService('ChangePasswordHandler')

  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly passwordService: PasswordService,
  ) {}

  async execute(command: ChangePasswordCommand): Promise<ChangePasswordResult> {
    const user = await this.userRepository.findById(command.userId)

    // El usuario viene de un token válido, así que esto no debería pasar nunca
    // salvo que lo hayan borrado con la sesión abierta.
    if (!user) throw AuthErrors.tokenInvalid({ reason: 'usuario inexistente' })

    const currentMatches = await this.passwordService.compare(
      command.currentPassword,
      user.passwordHash,
    )

    if (!currentMatches) {
      this.logger.warn(
        'Cambio de contraseña rechazado: contraseña actual incorrecta',
        {
          operation: 'auth_change_password_failed',
          userId: user.id,
        },
      )
      throw AuthErrors.currentPasswordInvalid()
    }

    const isSamePassword = await this.passwordService.compare(
      command.newPassword,
      user.passwordHash,
    )

    if (isSamePassword) throw AuthErrors.passwordReused()

    const passwordHash = await this.passwordService.hash(command.newPassword)
    await this.userRepository.changePassword(user.id, passwordHash)

    const revokedSessions = await this.refreshTokenRepository.revokeAllForUser(
      user.id,
    )

    this.logger.log('Contraseña cambiada', {
      operation: 'auth_change_password',
      userId: user.id,
      revokedSessions,
    })

    return { revokedSessions }
  }
}
