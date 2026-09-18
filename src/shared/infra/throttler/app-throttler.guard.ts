import { ExecutionContext, Injectable } from '@nestjs/common'
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler'
import { Request, Response } from 'express'

import { AppException } from '../../errors/app.exception'
import { CustomLoggerService } from '../../core/logger.service'
import { getCorrelationId } from '../middleware/correlation-id.middleware'

/**
 * Guard de rate limiting.
 *
 * Aporta tres cosas sobre el `ThrottlerGuard` de base:
 *
 * 1. **Cuenta por usuario cuando hay sesión.** Si no, todos los usuarios detrás
 *    de un mismo NAT corporativo comparten cupo.
 * 2. **Respeta el proxy.** Con `TRUST_PROXY=true`, `req.ips[0]` es el cliente
 *    real y no el balanceador; sin eso, todo el tráfico cuenta como una sola IP.
 * 3. **Responde en el formato de error de la API**, con `Retry-After`.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new CustomLoggerService('Throttler')

  protected async getTracker(req: Request): Promise<string> {
    // `req.user` lo completa JwtAuthGuard, que corre *después* de este guard,
    // así que sólo está disponible en el segundo request de una sesión en
    // adelante si algún otro middleware lo resolvió antes. Mientras no esté,
    // caemos a la IP, que es el comportamiento correcto para endpoints
    // anónimos como login.
    const userId = req.user?.id
    if (userId) return `user:${userId}`

    const forwarded =
      Array.isArray(req.ips) && req.ips.length ? req.ips[0] : null
    return `ip:${forwarded ?? req.ip ?? 'unknown'}`
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<Request>()
    const response = context.switchToHttp().getResponse<Response>()

    const retryAfterSeconds = this.resolveRetryAfter(detail)

    response.setHeader('Retry-After', retryAfterSeconds)
    response.setHeader('X-RateLimit-Limit', detail.limit)
    response.setHeader('X-RateLimit-Remaining', 0)

    this.logger.warn('Rate limit superado', {
      correlationId: getCorrelationId(request),
      operation: 'rate_limit_exceeded',
      method: request.method,
      url: request.originalUrl ?? request.url,
      tracker: await this.getTracker(request),
      limit: detail.limit,
      totalHits: detail.totalHits,
      retryAfterSeconds,
    })

    throw AppException.tooManyRequests(
      `Demasiadas solicitudes. Reintentá en ${retryAfterSeconds} segundo(s).`,
      { metadata: { retryAfterSeconds, limit: detail.limit } },
    )
  }

  /** `timeToBlockExpire`/`timeToExpire` vienen en segundos; `ttl`, en ms. */
  private resolveRetryAfter(detail: ThrottlerLimitDetail): number {
    const candidate =
      detail.timeToBlockExpire || detail.timeToExpire || detail.ttl / 1000

    return Math.max(1, Math.ceil(candidate))
  }
}
