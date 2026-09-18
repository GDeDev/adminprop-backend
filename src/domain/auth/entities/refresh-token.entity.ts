export interface RefreshToken {
  id: string
  tokenHash: string
  userId: string
  familyId: string
  expiresAt: Date
  revokedAt: Date | null
  replacedById: string | null
  userAgent: string | null
  ip: string | null
  createdAt: Date
}

/** Datos para persistir un refresh token recién emitido. */
export interface CreateRefreshTokenData {
  tokenHash: string
  userId: string
  familyId: string
  expiresAt: Date
  userAgent?: string | null
  ip?: string | null
}

export function isRefreshTokenUsable(
  token: RefreshToken,
  now: Date = new Date(),
): boolean {
  return token.revokedAt === null && token.expiresAt > now
}
