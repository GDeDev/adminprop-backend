import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import {
  PublicUser,
  toPublicUser,
} from '@/modules/auth/domain/entities/user.entity'
import { RefreshTokenRepository } from '@/modules/auth/domain/repositories/refresh-token.repository'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { UserManagementPolicy } from '@/modules/auth/domain/user-management.policy'
import { createLogger } from '@/shared/logging/root-logger'
import { SetUserActiveCommand } from './set-user-active.command'

/**
 * Desactivar (spec Fase 4, 3.6) y reactivar. Nunca borra: el usuario queda
 * con su historial de auditoría y se puede volver a habilitar.
 *
 * Al desactivar se revocan sus refresh tokens y, como el guard valida al
 * usuario en cada request, su access token deja de servir en el acto.
 */
@CommandHandler(SetUserActiveCommand)
export class SetUserActiveHandler implements ICommandHandler<
  SetUserActiveCommand,
  PublicUser
> {
  private readonly logger = createLogger('SetUserActiveHandler')

  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(command: SetUserActiveCommand): Promise<PublicUser> {
    const target = UserManagementPolicy.requireManageable(
      await this.users.findById(command.userId),
      command.userId,
    )

    if (!command.isActive) {
      UserManagementPolicy.assertCanDeactivate(command.actorId, target)
    }

    const updated = await this.users.setActive(target.id, command.isActive)

    const revokedSessions = command.isActive
      ? 0
      : await this.refreshTokens.revokeAllForUser(target.id)

    this.logger.info(
      {
        operation: command.isActive ? 'user_activated' : 'user_deactivated',
        targetUserId: target.id,
        revokedSessions,
      },
      command.isActive ? 'Usuario reactivado' : 'Usuario desactivado',
    )

    return toPublicUser(updated)
  }
}
