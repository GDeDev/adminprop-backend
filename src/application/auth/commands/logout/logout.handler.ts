import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { RefreshTokenRepository } from '@/domain/auth/repositories/refresh-token.repository'
import { TokenService } from '@/infrastructure/auth/services/token.service'
import { CustomLoggerService } from '@/shared/core/logger.service'
import { LogoutCommand } from './logout.command'

/**
 * Cierra la sesión asociada a un refresh token.
 *
 * Es idempotente y nunca falla: un logout con un token vencido, ya revocado o
 * directamente inválido responde 204 igual. Que el cliente no pueda cerrar
 * sesión porque el token ya venció sería absurdo, y devolver error acá sólo
 * sirve para confirmarle a un atacante si un token existe.
 *
 * El access token sigue siendo válido hasta que expire (15m por defecto): es el
 * precio de no consultar la base en cada request. Si necesitás corte inmediato,
 * activá `JWT_VALIDATE_USER_ON_REQUEST`.
 */
@CommandHandler(LogoutCommand)
export class LogoutHandler implements ICommandHandler<LogoutCommand, void> {
  private readonly logger = new CustomLoggerService('LogoutHandler')

  constructor(
    private readonly tokenService: TokenService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  async execute(command: LogoutCommand): Promise<void> {
    const tokenHash = this.tokenService.hashToken(command.refreshToken)
    const stored = await this.refreshTokenRepository.findByTokenHash(tokenHash)

    if (!stored) return

    await this.refreshTokenRepository.revokeById(stored.id)

    this.logger.log('Sesión cerrada', {
      operation: 'auth_logout',
      userId: stored.userId,
      familyId: stored.familyId,
    })
  }
}
