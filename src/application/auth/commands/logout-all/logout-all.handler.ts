import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { RefreshTokenRepository } from '@/domain/auth/repositories/refresh-token.repository'
import { createLogger } from '@/shared/logging/root-logger'
import { LogoutAllCommand } from './logout-all.command'

export interface LogoutAllResult {
  revokedSessions: number
}

/** Cierra todas las sesiones del usuario en todos sus dispositivos. */
@CommandHandler(LogoutAllCommand)
export class LogoutAllHandler implements ICommandHandler<
  LogoutAllCommand,
  LogoutAllResult
> {
  private readonly logger = createLogger('LogoutAllHandler')

  constructor(
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  async execute(command: LogoutAllCommand): Promise<LogoutAllResult> {
    const revokedSessions = await this.refreshTokenRepository.revokeAllForUser(
      command.userId,
    )

    this.logger.info(
      {
        operation: 'auth_logout_all',
        userId: command.userId,
        revokedSessions,
      },
      'Todas las sesiones cerradas',
    )

    return { revokedSessions }
  }
}
