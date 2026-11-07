import { isIP } from 'node:net'
import { Request } from 'express'

import {
  isTrustedServerSecret,
  TRUSTED_SERVER_HEADER,
} from '../throttler/trusted-server'

/**
 * Header con la IP del visitante que manda un servidor propio (`apps/sites`, el
 * BFF de sesión del backoffice) cuando pide en su nombre. Sólo vale junto con
 * un `X-Sites-Secret` válido (D-252).
 */
export const CLIENT_IP_HEADER = 'x-client-ip'

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

/**
 * La IP del cliente para el throttle, la auditoría y los logs.
 *
 * - Un servidor propio que se identifica con el secreto compartido puede
 *   declarar la IP del visitante en `X-Client-IP`: sin esto, todos los
 *   visitantes de los sitios (y todos los logins que pasan por el BFF) cuentan
 *   como la IP de ese servidor. Sin el secreto el header se ignora: si no,
 *   cualquiera elegiría su IP y esquivaría el tope por IP.
 * - Si no, `req.ip`, que Express calcula con `trust proxy`
 *   (`TRUST_PROXY_HOPS`): la primera dirección no confiable contando desde
 *   este servidor. Antes se usaba `req.ips[0]`, que con más saltos confiados
 *   que proxies reales es una dirección que el cliente puede inventar.
 */
export function resolveClientIp(
  req: Request,
  serverSecrets: readonly string[],
): string | undefined {
  const declared = first(req.headers[CLIENT_IP_HEADER])?.trim()
  if (
    declared &&
    isIP(declared) !== 0 &&
    isTrustedServerSecret(
      first(req.headers[TRUSTED_SERVER_HEADER]),
      serverSecrets,
    )
  ) {
    return declared
  }
  return req.ip
}
