import { Injectable } from '@nestjs/common'

import { User } from '@/domain/auth/entities/user.entity'
import { RefreshTokenRepository } from '@/domain/auth/repositories/refresh-token.repository'
import {
  AuthTokens,
  SessionContext,
} from '@/application/auth/results/auth-result'
import { TokenService } from './token.service'

/**
 * Emite el par access + refresh y persiste el refresh.
 *
 * Lo comparten el registro, el login y la rotación para que el formato del par
 * de tokens se defina en un solo lugar.
 */
@Injectable()
export class AuthTokenIssuer {
  constructor(
    private readonly tokenService: TokenService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  /** Arranca una sesión nueva (login o registro): abre una familia nueva. */
  async issueNewSession(
    user: User,
    context: SessionContext = {},
  ): Promise<AuthTokens> {
    const access = await this.tokenService.signAccessToken(user)
    const refresh = await this.tokenService.signRefreshToken(user.id)

    await this.refreshTokenRepository.create({
      tokenHash: refresh.tokenHash,
      userId: user.id,
      familyId: refresh.familyId,
      expiresAt: refresh.expiresAt,
      userAgent: context.userAgent,
      ip: context.ip,
    })

    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: access.expiresIn,
    }
  }

  /**
   * Rota una sesión existente: emite tokens nuevos dentro de la misma familia
   * y revoca el refresh anterior en la misma transacción.
   */
  async rotateSession(
    user: User,
    currentTokenId: string,
    familyId: string,
    context: SessionContext = {},
  ): Promise<AuthTokens> {
    const access = await this.tokenService.signAccessToken(user)
    const refresh = await this.tokenService.signRefreshToken(user.id, familyId)

    await this.refreshTokenRepository.rotate(currentTokenId, {
      tokenHash: refresh.tokenHash,
      userId: user.id,
      familyId,
      expiresAt: refresh.expiresAt,
      userAgent: context.userAgent,
      ip: context.ip,
    })

    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: access.expiresIn,
    }
  }
}
