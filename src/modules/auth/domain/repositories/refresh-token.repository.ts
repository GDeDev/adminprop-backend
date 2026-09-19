import {
  CreateRefreshTokenData,
  RefreshToken,
} from '../entities/refresh-token.entity'

export abstract class RefreshTokenRepository {
  abstract create(data: CreateRefreshTokenData): Promise<RefreshToken>

  abstract findByTokenHash(tokenHash: string): Promise<RefreshToken | null>

  /**
   * Rota un token: marca el viejo como revocado apuntando al nuevo y persiste
   * el nuevo. Va en una transacción para que no pueda quedar un token viejo
   * revocado sin su reemplazo.
   */
  abstract rotate(
    currentTokenId: string,
    next: CreateRefreshTokenData,
  ): Promise<RefreshToken>

  abstract revokeById(id: string): Promise<void>

  /**
   * Revoca toda una familia de rotaciones. Se llama cuando detectamos el reuso
   * de un token ya rotado: no sabemos si el token lo tiene el usuario o un
   * atacante, así que se cae toda la cadena.
   */
  abstract revokeFamily(familyId: string): Promise<number>

  /** Cierra todas las sesiones activas de un usuario. */
  abstract revokeAllForUser(userId: string): Promise<number>

  /** Borra los tokens vencidos o revocados hace rato. Para el job de limpieza. */
  abstract deleteExpired(before: Date): Promise<number>
}
