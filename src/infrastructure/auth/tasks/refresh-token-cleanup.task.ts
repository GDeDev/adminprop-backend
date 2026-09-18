import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'

import { RefreshTokenRepository } from '@/domain/auth/repositories/refresh-token.repository'
import { createLogger } from '@/shared/logging/root-logger'

/** Cuánto se conserva un token vencido o revocado antes de borrarlo. */
const RETENTION_DAYS = 30

/**
 * Borra los refresh tokens vencidos o revocados hace más de 30 días.
 *
 * Sin esto la tabla crece indefinidamente: cada login y cada rotación dejan una
 * fila. Se conserva un mes para poder auditar una cadena de rotaciones después
 * de detectar un reuso.
 *
 * ⚠️ Corre en **cada instancia** de la aplicación. Con varias réplicas vas a
 * tener varias ejecuciones simultáneas; el `deleteMany` es idempotente así que
 * no rompe nada, sólo hace trabajo de más. Si te molesta, movelo a un CronJob
 * de Kubernetes o usá un lock distribuido.
 */
@Injectable()
export class RefreshTokenCleanupTask {
  private readonly logger = createLogger('RefreshTokenCleanup')

  constructor(
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000)

    try {
      const deleted = await this.refreshTokenRepository.deleteExpired(cutoff)

      if (deleted > 0) {
        this.logger.info(
          {
            operation: 'refresh_token_cleanup',
            deleted,
            cutoff: cutoff.toISOString(),
          },
          `Se borraron ${deleted} refresh token(s) vencidos`,
        )
      }
    } catch (error) {
      // Que falle la limpieza no puede tumbar la app: se reintenta mañana.
      this.logger.error(
        { operation: 'refresh_token_cleanup_failed', err: error },
        'Falló la limpieza de refresh tokens',
      )
    }
  }
}
