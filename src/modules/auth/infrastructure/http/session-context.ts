import { Request } from 'express'

import { SessionContext } from '@/modules/auth/application/results/auth-result'

/** Largo de la columna `refresh_tokens.user_agent`. */
const MAX_USER_AGENT_LENGTH = 255

/**
 * Arma el contexto que se guarda junto al refresh token.
 * Sirve para que el usuario vea desde dónde tiene sesiones abiertas y para
 * investigar un reuso de token.
 */
export function sessionContextFrom(request: Request): SessionContext {
  const userAgent = request.headers['user-agent']

  return {
    userAgent:
      typeof userAgent === 'string'
        ? userAgent.slice(0, MAX_USER_AGENT_LENGTH)
        : null,
    // Con TRUST_PROXY activo, `req.ips[0]` es el cliente real y no el balanceador.
    ip:
      (Array.isArray(request.ips) && request.ips.length
        ? request.ips[0]
        : request.ip) ?? null,
  }
}
