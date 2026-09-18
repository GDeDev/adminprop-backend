import { Injectable, NestMiddleware } from '@nestjs/common'
import { NextFunction, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'

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

/** Un ID de correlación ajeno no se loguea crudo: lo acotamos y sanitizamos. */
const MAX_LENGTH = 128
const SAFE_PATTERN = /^[A-Za-z0-9._:=+/-]+$/

/**
 * Asigna un ID de correlación a cada request.
 *
 * Va como middleware —y no como interceptor— a propósito: los middlewares
 * corren antes que los guards, así que las respuestas rechazadas por el
 * throttler o por el guard de JWT también salen con su `x-correlation-id`.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    req.headers[CORRELATION_ID_HEADER] = this.resolve(req)
    res.setHeader(CORRELATION_ID_HEADER, req.headers[CORRELATION_ID_HEADER])
    next()
  }

  private resolve(req: Request): string {
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
}

/** Lee el ID de correlación ya asignado por el middleware. */
export function getCorrelationId(req: {
  headers?: Record<string, unknown>
}): string {
  const value = req?.headers?.[CORRELATION_ID_HEADER]
  return typeof value === 'string' ? value : 'unknown'
}
