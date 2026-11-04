import { SetMetadata } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'node:crypto'

/** Header con el que un servidor propio de confianza se identifica ante la API. */
export const TRUSTED_SERVER_HEADER = 'x-sites-secret'

export const SKIP_THROTTLE_FOR_TRUSTED_SERVER = 'skipThrottleForTrustedServer'

/**
 * Marca un endpoint cuyo tope por IP se saltea cuando el pedido trae el secreto
 * compartido de un servidor propio (hoy, `apps/sites`).
 *
 * Es necesario porque ese servidor pide en nombre de todos los visitantes de
 * todas las inmobiliarias desde UNA sola IP: con un tope por IP, un tope
 * "por visitante" se vuelve un tope global compartido por todos los sitios, y
 * un bot contra un sitio dejaría sin servicio a los demás. Sin el secreto (o
 * con uno distinto) el endpoint sigue limitado como cualquier lectura pública.
 */
export const SkipThrottleForTrustedServer = () =>
  SetMetadata(SKIP_THROTTLE_FOR_TRUSTED_SERVER, true)

/**
 * Compara el secreto recibido con el esperado en tiempo constante (sobre los
 * hashes, que tienen el mismo largo siempre) para no filtrar cuánto coincide.
 */
export function isTrustedServerSecret(
  received: string | undefined,
  expected: string | null | undefined,
): boolean {
  if (!received || !expected) return false
  const hash = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(received), hash(expected))
}
