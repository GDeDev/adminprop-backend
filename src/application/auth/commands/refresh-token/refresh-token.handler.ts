import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { isRefreshTokenUsable } from '@/domain/auth/entities/refresh-token.entity'
import { AuthErrors } from '@/domain/auth/exceptions/auth.exceptions'
import { RefreshTokenRepository } from '@/domain/auth/repositories/refresh-token.repository'
import { UserRepository } from '@/domain/auth/repositories/user.repository'
import { AuthTokenIssuer } from '@/infrastructure/auth/services/auth-token-issuer.service'
import { RefreshTokenAlreadyRotatedError } from '@/infrastructure/auth/repositories/refresh-token.repository.impl'
import { TokenService } from '@/infrastructure/auth/services/token.service'
import { CustomLoggerService } from '@/shared/core/logger.service'
import { AuthTokens } from '../../results/auth-result'
import { RefreshTokenCommand } from './refresh-token.command'

/**
 * Rota el refresh token.
 *
 * El punto importante es la **detección de reuso**: cada refresh token se usa
 * una sola vez. Si llega uno que ya fue rotado, hay dos posibilidades —el
 * usuario mandó dos veces el mismo, o alguien le robó el token— y no podemos
 * distinguirlas. Ante la duda, se revoca toda la familia: el atacante pierde el
 * acceso y el usuario legítimo tiene que volver a loguearse.
 */
@CommandHandler(RefreshTokenCommand)
export class RefreshTokenHandler implements ICommandHandler<
  RefreshTokenCommand,
  AuthTokens
> {
  private readonly logger = new CustomLoggerService('RefreshTokenHandler')

  constructor(
    private readonly tokenService: TokenService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly userRepository: UserRepository,
    private readonly tokenIssuer: AuthTokenIssuer,
  ) {}

  async execute(command: RefreshTokenCommand): Promise<AuthTokens> {
    // 1. Validar la firma primero: filtra tokens basura sin tocar la base.
    const payload = await this.tokenService.verifyRefreshToken(
      command.refreshToken,
    )

    // 2. Buscar el token por su hash.
    const tokenHash = this.tokenService.hashToken(command.refreshToken)
    const stored = await this.refreshTokenRepository.findByTokenHash(tokenHash)

    if (!stored) {
      // Firma válida pero no está en la base: o se hizo limpieza de vencidos, o
      // el token viene de otro entorno que comparte secreto. No es reuso.
      this.logger.warn('Refresh token válido pero inexistente en la base', {
        operation: 'auth_refresh_failed',
        reason: 'not_found',
        userId: payload.sub,
      })
      throw AuthErrors.refreshTokenInvalid({ reason: 'not_found' })
    }

    // 3. Detección de reuso.
    if (stored.revokedAt !== null) {
      const revokedCount = await this.refreshTokenRepository.revokeFamily(
        stored.familyId,
      )

      this.logger.error(
        'Reuso de refresh token detectado: se revocó toda la familia',
        undefined,
        {
          operation: 'auth_refresh_reuse_detected',
          userId: stored.userId,
          familyId: stored.familyId,
          revokedTokens: revokedCount,
          ip: command.context.ip,
          userAgent: command.context.userAgent,
        },
      )

      throw AuthErrors.refreshTokenReused({ familyId: stored.familyId })
    }

    if (!isRefreshTokenUsable(stored)) {
      throw AuthErrors.refreshTokenExpired()
    }

    // 4. El usuario tiene que seguir existiendo y estando habilitado.
    const user = await this.userRepository.findById(stored.userId)

    if (!user) {
      await this.refreshTokenRepository.revokeFamily(stored.familyId)
      throw AuthErrors.refreshTokenInvalid({ reason: 'usuario inexistente' })
    }

    if (!user.isActive) {
      await this.refreshTokenRepository.revokeAllForUser(user.id)
      throw AuthErrors.accountInactive()
    }

    // 5. Rotar.
    try {
      const tokens = await this.tokenIssuer.rotateSession(
        user,
        stored.id,
        stored.familyId,
        command.context,
      )

      this.logger.log('Refresh token rotado', {
        operation: 'auth_refresh',
        userId: user.id,
        familyId: stored.familyId,
      })

      return tokens
    } catch (error) {
      if (error instanceof RefreshTokenAlreadyRotatedError) {
        // Dos refresh simultáneos con el mismo token (típico: varias pestañas).
        // Perdimos la carrera; el cliente reintenta con el token nuevo.
        this.logger.warn('Rotación concurrente del mismo refresh token', {
          operation: 'auth_refresh_race',
          userId: user.id,
          familyId: stored.familyId,
        })
        throw AuthErrors.refreshTokenInvalid({ reason: 'rotación concurrente' })
      }
      throw error
    }
  }
}
