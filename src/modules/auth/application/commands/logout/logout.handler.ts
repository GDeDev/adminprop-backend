import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { AuditFacade, actorKindOf } from '@/modules/audit/public'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { RefreshTokenRepository } from '@/modules/auth/domain/repositories/refresh-token.repository'
import { TokenService } from '@/modules/auth/infrastructure/services/token.service'
import { createLogger } from '@/shared/logging/root-logger'
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
  private readonly logger = createLogger('LogoutHandler')

  constructor(
    private readonly tokenService: TokenService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly userRepository: UserRepository,
    private readonly audit: AuditFacade,
  ) {}

  async execute(command: LogoutCommand): Promise<void> {
    const tokenHash = this.tokenService.hashToken(command.refreshToken)
    const stored = await this.refreshTokenRepository.findByTokenHash(tokenHash)

    if (!stored) return

    await this.refreshTokenRepository.revokeById(stored.id)

    // El endpoint es público: el tenant sale del usuario dueño del token.
    const user = await this.userRepository.findByIdForSession(stored.userId)
    if (user) {
      await this.audit.record({
        action: 'LOGOUT',
        entity: 'User',
        entityId: user.id,
        summary: 'Cerró sesión',
        tenantId: user.tenantId,
        userId: user.id,
        userEmail: user.email,
        actorKind: actorKindOf(user.role, true),
      })
    }

    this.logger.info(
      {
        operation: 'auth_logout',
        userId: stored.userId,
        familyId: stored.familyId,
      },
      'Sesión cerrada',
    )
  }
}
