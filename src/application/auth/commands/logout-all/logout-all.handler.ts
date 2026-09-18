import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { RefreshTokenRepository } from '@/domain/auth/repositories/refresh-token.repository'
import { CustomLoggerService } from '@/shared/core/logger.service'
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
  private readonly logger = new CustomLoggerService('LogoutAllHandler')

  constructor(
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  async execute(command: LogoutAllCommand): Promise<LogoutAllResult> {
    const revokedSessions = await this.refreshTokenRepository.revokeAllForUser(
      command.userId,
    )

    this.logger.log('Todas las sesiones cerradas', {
      operation: 'auth_logout_all',
      userId: command.userId,
      revokedSessions,
    })

    return { revokedSessions }
  }
}
