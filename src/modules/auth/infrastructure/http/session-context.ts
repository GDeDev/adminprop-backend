import { Request } from 'express'

import { SessionContext } from '@/modules/auth/application/results/auth-result'
import { RequestContext } from '@/shared/context/request-context'

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
    // La resolvió el middleware de contexto (`resolveClientIp`, D-252): la del
    // visitante aunque el login llegue por el BFF del backoffice.
    ip: RequestContext.get()?.ip ?? request.ip ?? null,
  }
}
