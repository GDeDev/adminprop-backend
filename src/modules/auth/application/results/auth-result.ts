import { PublicUser } from '@/modules/auth/domain/entities/user.entity'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  /** Segundos de vida que le quedan al access token. */
  expiresIn: number
}

export interface AuthResult {
  user: PublicUser
  tokens: AuthTokens
}

/** Contexto del request que guardamos junto al refresh token, para auditar. */
export interface SessionContext {
  userAgent?: string | null
  ip?: string | null
}
