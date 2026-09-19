import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService, TokenExpiredError } from '@nestjs/jwt'
import { createHash, randomUUID } from 'node:crypto'

import { Configuration, JwtConfig } from '@/shared/config/configuration'
import { User } from '@/modules/auth/domain/entities/user.entity'
import { AuthErrors } from '@/modules/auth/domain/exceptions/auth.exceptions'
import {
  AccessTokenPayload,
  RefreshTokenPayload,
  TOKEN_TYPE_ACCESS,
  TOKEN_TYPE_REFRESH,
} from '../types/jwt-payload.type'

export interface SignedAccessToken {
  token: string
  /** Segundos hasta el vencimiento, para que el cliente sepa cuándo refrescar. */
  expiresIn: number
}

export interface SignedRefreshToken {
  token: string
  /** Hash SHA-256 que se persiste. El token en sí nunca se guarda. */
  tokenHash: string
  jti: string
  familyId: string
  expiresAt: Date
}

/**
 * Emisión y verificación de tokens.
 *
 * - **Access token**: JWT stateless, corto (15m por defecto). No se consulta la
 *   base en cada request.
 * - **Refresh token**: JWT firmado con *otro* secreto, largo, y además
 *   persistido como hash. La firma se valida antes de tocar la base (filtra
 *   basura barato) y el hash decide si la sesión sigue viva.
 *
 * Cada token lleva un claim `typ`: aunque los secretos ya son distintos, evita
 * por completo que un access token pase por refresh o al revés.
 */
@Injectable()
export class TokenService {
  private readonly config: JwtConfig

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService<Configuration, true>,
  ) {
    this.config = configService.get('jwt', { infer: true })
  }

  async signAccessToken(user: User): Promise<SignedAccessToken> {
    const payload: Omit<AccessTokenPayload, 'iat' | 'exp' | 'iss' | 'aud'> = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      typ: TOKEN_TYPE_ACCESS,
    }

    const token = await this.jwtService.signAsync(payload, {
      secret: this.config.accessSecret,
      expiresIn: this.config.accessTtl,
      issuer: this.config.issuer,
      audience: this.config.audience,
    })

    return { token, expiresIn: this.expiresInSeconds(token) }
  }

  /**
   * Emite un refresh token. Si no le pasás `familyId` arranca una familia nueva
   * (o sea: es un login, no una rotación).
   */
  async signRefreshToken(
    userId: string,
    familyId?: string,
  ): Promise<SignedRefreshToken> {
    const jti = randomUUID()
    const resolvedFamilyId = familyId ?? randomUUID()

    const payload: Omit<RefreshTokenPayload, 'iat' | 'exp' | 'iss' | 'aud'> = {
      sub: userId,
      jti,
      fid: resolvedFamilyId,
      typ: TOKEN_TYPE_REFRESH,
    }

    const token = await this.jwtService.signAsync(payload, {
      secret: this.config.refreshSecret,
      expiresIn: this.config.refreshTtl,
      issuer: this.config.issuer,
      audience: this.config.audience,
    })

    return {
      token,
      tokenHash: this.hashToken(token),
      jti,
      familyId: resolvedFamilyId,
      expiresAt: this.expiresAt(token),
    }
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const payload = await this.verify<AccessTokenPayload>(
      token,
      this.config.accessSecret,
      () => AuthErrors.tokenExpired(),
      (reason) => AuthErrors.tokenInvalid({ reason }),
    )

    if (payload.typ !== TOKEN_TYPE_ACCESS) {
      throw AuthErrors.tokenInvalid({ reason: 'tipo de token incorrecto' })
    }

    return payload
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    const payload = await this.verify<RefreshTokenPayload>(
      token,
      this.config.refreshSecret,
      () => AuthErrors.refreshTokenExpired(),
      (reason) => AuthErrors.refreshTokenInvalid({ reason }),
    )

    if (payload.typ !== TOKEN_TYPE_REFRESH) {
      throw AuthErrors.refreshTokenInvalid({
        reason: 'tipo de token incorrecto',
      })
    }

    return payload
  }

  /** SHA-256 en hex. Es lo único del refresh token que toca la base. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  // ------------------------------------------------------------------ internos

  private async verify<T extends object>(
    token: string,
    secret: string,
    onExpired: () => Error,
    onInvalid: (reason: string) => Error,
  ): Promise<T> {
    try {
      return await this.jwtService.verifyAsync<T>(token, {
        secret,
        issuer: this.config.issuer,
        audience: this.config.audience,
      })
    } catch (error) {
      if (error instanceof TokenExpiredError) throw onExpired()
      throw onInvalid(error instanceof Error ? error.message : 'desconocido')
    }
  }

  private decodeExp(token: string): number {
    const decoded = this.jwtService.decode(token) as { exp?: number } | null

    if (!decoded?.exp) {
      // No debería pasar nunca: lo firmamos nosotros con expiresIn.
      throw new Error('El token emitido no tiene claim "exp"')
    }

    return decoded.exp
  }

  private expiresAt(token: string): Date {
    return new Date(this.decodeExp(token) * 1000)
  }

  private expiresInSeconds(token: string): number {
    return Math.max(0, this.decodeExp(token) - Math.floor(Date.now() / 1000))
  }
}
