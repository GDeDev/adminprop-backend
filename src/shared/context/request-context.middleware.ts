import { Injectable, NestMiddleware } from '@nestjs/common'
import { NextFunction, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'

import { RequestContext } from './request-context'

export const CORRELATION_ID_HEADER = 'x-correlation-id'

/**
 * Headers de los que aceptamos un ID de correlación entrante, por orden de
 * prioridad. Cubre los que suelen inyectar balanceadores y gateways.
 */
const INBOUND_HEADERS = [
  'x-correlation-id',
  'x-request-id',
  'x-trace-id',
  'x-amzn-trace-id',
]

/** Un ID de correlación ajeno no se propaga crudo: lo acotamos y sanitizamos. */
const MAX_LENGTH = 128
const SAFE_PATTERN = /^[A-Za-z0-9._:=+/-]+$/
const MAX_USER_AGENT_LENGTH = 255

/**
 * Abre el `RequestContext` y asigna el ID de correlación.
 *
 * Va como middleware —y no como interceptor— a propósito: los middlewares
 * corren antes que los guards, así que las respuestas rechazadas por el
 * throttler o por el guard de JWT también salen con su `x-correlation-id` y
 * quedan logueadas con contexto.
 *
 * Todo lo que ocurre después del `next()` pasa dentro del scope, incluidos los
 * handlers de CQRS y los repositorios.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = this.resolveCorrelationId(req)

    req.headers[CORRELATION_ID_HEADER] = correlationId
    res.setHeader(CORRELATION_ID_HEADER, correlationId)

    const userAgent = req.headers['user-agent']

    RequestContext.run(
      {
        correlationId,
        ip: this.resolveIp(req),
        userAgent:
          typeof userAgent === 'string'
            ? userAgent.slice(0, MAX_USER_AGENT_LENGTH)
            : undefined,
        method: req.method,
        url: req.originalUrl ?? req.url,
      },
      () => next(),
    )
  }

  private resolveCorrelationId(req: Request): string {
    for (const header of INBOUND_HEADERS) {
      const raw = req.headers[header]
      const value = Array.isArray(raw) ? raw[0] : raw

      if (typeof value === 'string') {
        const trimmed = value.trim().slice(0, MAX_LENGTH)
        if (trimmed && SAFE_PATTERN.test(trimmed)) return trimmed
      }
    }

    return uuidv4()
  }

  /** Con `TRUST_PROXY` activo, `req.ips[0]` es el cliente y no el balanceador. */
  private resolveIp(req: Request): string | undefined {
    if (Array.isArray(req.ips) && req.ips.length) return req.ips[0]
    return req.ip
  }
}

/**
 * Lee el ID de correlación.
 *
 * Prefiere el `RequestContext`; cae al header para los pocos lugares que reciben
 * un `Request` pero corren fuera del scope (por ejemplo, un filtro de excepción
 * disparado por un error del propio middleware).
 */
export function getCorrelationId(req?: {
  headers?: Record<string, unknown>
}): string {
  const fromContext = RequestContext.correlationId
  if (fromContext) return fromContext

  const value = req?.headers?.[CORRELATION_ID_HEADER]
  return typeof value === 'string' ? value : 'unknown'
}
