import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
  CreateRefreshTokenData,
  RefreshToken,
} from '@/domain/auth/entities/refresh-token.entity'
import { RefreshTokenRepository } from '@/domain/auth/repositories/refresh-token.repository'

@Injectable()
export class RefreshTokenRepositoryImpl extends RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: CreateRefreshTokenData): Promise<RefreshToken> {
    const row = await this.prisma.db.refreshToken.create({
      data: {
        tokenHash: data.tokenHash,
        userId: data.userId,
        familyId: data.familyId,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent ?? null,
        ip: data.ip ?? null,
      },
    })
    return row as RefreshToken
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    const row = await this.prisma.db.refreshToken.findUnique({
      where: { tokenHash },
    })
    return (row as RefreshToken) ?? null
  }

  async rotate(
    currentTokenId: string,
    next: CreateRefreshTokenData,
  ): Promise<RefreshToken> {
    return this.prisma.db.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          tokenHash: next.tokenHash,
          userId: next.userId,
          familyId: next.familyId,
          expiresAt: next.expiresAt,
          userAgent: next.userAgent ?? null,
          ip: next.ip ?? null,
        },
      })

      // `revokedAt: null` en el where hace que la rotación sea idempotente: si
      // dos requests rotan el mismo token a la vez, sólo una lo revoca.
      const revoked = await tx.refreshToken.updateMany({
        where: { id: currentTokenId, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: created.id },
      })

      if (revoked.count === 0) {
        // Otro request ganó la carrera. Abortamos la transacción para no dejar
        // dos tokens vivos de la misma cadena.
        throw new RefreshTokenAlreadyRotatedError(currentTokenId)
      }

      return created as RefreshToken
    })
  }

  async revokeById(id: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  async revokeFamily(familyId: string): Promise<number> {
    const result = await this.prisma.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = await this.prisma.db.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }],
      },
    })
    return result.count
  }
}

/** Se lanza cuando dos rotaciones concurrentes compiten por el mismo token. */
export class RefreshTokenAlreadyRotatedError extends Error {
  constructor(tokenId: string) {
    super(`El refresh token ${tokenId} ya fue rotado por otro request`)
    this.name = 'RefreshTokenAlreadyRotatedError'
  }
}
