import { SetMetadata } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

/** Header con el que un servidor propio de confianza se identifica ante la API. */
export const TRUSTED_SERVER_HEADER = 'x-sites-secret'

export const SKIP_THROTTLE_FOR_TRUSTED_SERVER = 'skipThrottleForTrustedServer'

/**
 * Marca un endpoint cuyo tope por IP se saltea cuando el pedido trae el secreto
 * compartido de un servidor propio (hoy, `apps/sites`) y NO trae `X-Client-IP`
 * (lecturas cacheadas sin visitante concreto).
 *
 * Ese servidor pide en nombre de todos los visitantes de todas las
 * inmobiliarias desde UNA sola IP. Por eso, si declara la IP del visitante en
 * `X-Client-IP`, el pedido NO se saltea: se cuenta por esa IP (ver
 * `resolveClientIp`) y cada visitante tiene su propio cupo. Sin el secreto (o
 * con uno distinto) el endpoint sigue limitado como cualquier lectura pública.
 */
export const SkipThrottleForTrustedServer = () =>
  SetMetadata(SKIP_THROTTLE_FOR_TRUSTED_SERVER, true)

/**
 * Compara el secreto recibido con los esperados en tiempo constante (sobre los
 * hashes, que tienen el mismo largo siempre) para no filtrar cuánto coincide.
 * Acepta uno o varios secretos válidos; los vacíos o ausentes no cuentan, y un
 * secreto recibido vacío nunca es válido. Se recorren todos, sin cortar en el
 * primero, para que el tiempo no dependa de cuál coincide.
 */
export function isTrustedServerSecret(
  received: string | undefined,
  expected: string | null | undefined | readonly (string | null | undefined)[],
): boolean {
  if (!received) return false
  const candidates = (Array.isArray(expected) ? expected : [expected]).filter(
    (secret): secret is string => typeof secret === 'string' && secret !== '',
  )
  const hash = (value: string) => createHash('sha256').update(value).digest()
  const receivedHash = hash(received)
  let matches = false
  for (const secret of candidates) {
    if (timingSafeEqual(receivedHash, hash(secret))) matches = true
  }
  return matches
}

/**
 * Si el throttle se saltea: el secreto es válido y no hay una `X-Client-IP`
 * válida por la cual contar.
 */
export function shouldSkipForTrustedServer(
  headers: Record<string, string | string[] | undefined>,
  serverSecrets: readonly string[],
): boolean {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value
  if (
    !isTrustedServerSecret(first(headers[TRUSTED_SERVER_HEADER]), serverSecrets)
  ) {
    return false
  }
  const declared = first(headers['x-client-ip'])?.trim()
  return !(declared && isIP(declared) !== 0)
}
