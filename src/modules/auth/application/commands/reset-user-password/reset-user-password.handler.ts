import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { RefreshTokenRepository } from '@/modules/auth/domain/repositories/refresh-token.repository'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { UserManagementPolicy } from '@/modules/auth/domain/user-management.policy'
import { PasswordService } from '@/modules/auth/infrastructure/services/password.service'
import { createLogger } from '@/shared/logging/root-logger'
import { ResetUserPasswordCommand } from './reset-user-password.command'

export interface ResetUserPasswordResult {
  revokedSessions: number
}

/**
 * Un admin le pone una contraseña nueva a otro usuario (el que se la olvidó).
 * Cierra todas sus sesiones y le desbloquea la cuenta si estaba bloqueada por
 * intentos fallidos.
 */
@CommandHandler(ResetUserPasswordCommand)
export class ResetUserPasswordHandler implements ICommandHandler<
  ResetUserPasswordCommand,
  ResetUserPasswordResult
> {
  private readonly logger = createLogger('ResetUserPasswordHandler')

  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly passwordService: PasswordService,
  ) {}

  async execute(
    command: ResetUserPasswordCommand,
  ): Promise<ResetUserPasswordResult> {
    const target = UserManagementPolicy.requireManageable(
      await this.users.findById(command.userId),
      command.userId,
    )
    UserManagementPolicy.assertCanResetPassword(command.actorId, target)

    const passwordHash = await this.passwordService.hash(command.newPassword)
    await this.users.changePassword(target.id, passwordHash)
    const revokedSessions = await this.refreshTokens.revokeAllForUser(target.id)

    this.logger.info(
      {
        operation: 'user_password_reset',
        targetUserId: target.id,
        revokedSessions,
      },
      'Contraseña reseteada por un admin',
    )

    return { revokedSessions }
  }
}
