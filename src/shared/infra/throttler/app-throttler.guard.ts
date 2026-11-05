import { ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler'
import { Request, Response } from 'express'

import { Configuration } from '../../config/configuration'
import { AppException } from '../../errors/app.exception'
import { createLogger } from '@/shared/logging/root-logger'
import { getCorrelationId } from '../../context/request-context.middleware'
import {
  isTrustedServerSecret,
  SKIP_THROTTLE_FOR_TRUSTED_SERVER,
  TRUSTED_SERVER_HEADER,
} from './trusted-server'

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
  private readonly logger = createLogger('Throttler')

  // Inyección por propiedad: el constructor de `ThrottlerGuard` ya tiene sus
  // propios parámetros y no hace falta repetirlos acá.
  @Inject(ConfigService)
  private readonly config!: ConfigService<Configuration, true>

  /**
   * Los endpoints marcados con `@SkipThrottleForTrustedServer()` no cuentan si
   * el pedido trae el secreto compartido del servidor de `apps/sites` (ver
   * `trusted-server.ts`). Cualquier otro pedido se limita como siempre.
   */
  protected override async shouldSkip(
    context: ExecutionContext,
  ): Promise<boolean> {
    const marked = this.reflector.getAllAndOverride<boolean | undefined>(
      SKIP_THROTTLE_FOR_TRUSTED_SERVER,
      [context.getHandler(), context.getClass()],
    )
    if (!marked) return false

    const request = context.switchToHttp().getRequest<Request>()
    const header = request.headers[TRUSTED_SERVER_HEADER]
    return isTrustedServerSecret(
      Array.isArray(header) ? header[0] : header,
      this.config.get('sites', { infer: true }).serverSecrets,
    )
  }

  protected override async getTracker(req: Request): Promise<string> {
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

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<Request>()
    const response = context.switchToHttp().getResponse<Response>()

    const retryAfterSeconds = this.resolveRetryAfter(detail)

    response.setHeader('Retry-After', retryAfterSeconds)
    response.setHeader('X-RateLimit-Limit', detail.limit)
    response.setHeader('X-RateLimit-Remaining', 0)

    this.logger.warn(
      {
        correlationId: getCorrelationId(request),
        operation: 'rate_limit_exceeded',
        method: request.method,
        url: request.originalUrl ?? request.url,
        tracker: await this.getTracker(request),
        limit: detail.limit,
        totalHits: detail.totalHits,
        retryAfterSeconds,
      },
      'Rate limit superado',
    )

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
