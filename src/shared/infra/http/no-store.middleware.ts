import type { NextFunction, Request, Response } from 'express'

const PUBLIC_API = /^\/api\/v\d+\/public\//

/**
 * `Cache-Control: no-store` en las respuestas de la API que llevan datos
 * privados (contratos, montos, DNI, CBU). Sin esto, un proxy corporativo o el
 * caché del navegador compartido de una PC de la inmobiliaria podría guardar
 * una respuesta autenticada.
 *
 * Se deja afuera `/api/vN/public/*`: ahí el sitio web cachea a propósito
 * (ISR) y los controllers fijan su propio `Cache-Control`. Los controllers
 * que lo necesiten pueden pisar el valor con `res.set`.
 */
export function noStoreForPrivateApi(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const path = req.originalUrl ?? req.url ?? ''
  if (path.startsWith('/api/') && !PUBLIC_API.test(path)) {
    res.setHeader('Cache-Control', 'no-store')
  }
  next()
}
