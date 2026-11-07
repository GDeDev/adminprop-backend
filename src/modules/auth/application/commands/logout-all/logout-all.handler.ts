import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { AuditFacade } from '@/modules/audit/public'
import { RefreshTokenRepository } from '@/modules/auth/domain/repositories/refresh-token.repository'
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
    private readonly audit: AuditFacade,
  ) {}

  async execute(command: LogoutAllCommand): Promise<LogoutAllResult> {
    const revokedSessions = await this.refreshTokenRepository.revokeAllForUser(
      command.userId,
    )

    // Autenticado: tenant, usuario y rol salen del RequestContext.
    await this.audit.record({
      action: 'LOGOUT',
      entity: 'User',
      entityId: command.userId,
      summary: `Cerró sesión en todos los dispositivos (${revokedSessions})`,
    })

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
