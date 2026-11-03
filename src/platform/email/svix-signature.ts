import { createHmac, timingSafeEqual } from 'node:crypto'

/** Ventana de tolerancia del timestamp: frena la repetición de un webhook capturado. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60

export interface SvixHeaders {
  id: string | undefined
  timestamp: string | undefined
  signature: string | undefined
}

/**
 * Firma Svix de un webhook (la que usa Resend): HMAC-SHA256, en base64, de
 * `<id>.<timestamp>.<cuerpo crudo>`, con la clave que está en base64 detrás
 * del prefijo `whsec_`. El header `svix-signature` trae una o más firmas
 * (`v1,<firma> v1,<otra>`) para poder rotar el secreto sin cortar el servicio.
 */
export function signSvix(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const digest = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')
  return `v1,${digest}`
}

/**
 * Verifica firma y timestamp. Compara en tiempo constante para no filtrar la
 * firma esperada por diferencias de tiempo.
 */
export function verifySvixSignature(
  secret: string,
  headers: SvixHeaders,
  body: string,
  now: Date = new Date(),
): boolean {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false

  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) return false
  if (Math.abs(now.getTime() / 1000 - sentAt) > SVIX_TOLERANCE_SECONDS) {
    return false
  }

  const expected = Buffer.from(
    signSvix(secret, id, timestamp, body).split(',')[1],
    'base64',
  )
  return signature.split(' ').some((candidate) => {
    const [version, value] = candidate.split(',')
    if (version !== 'v1' || !value) return false
    const received = Buffer.from(value, 'base64')
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    )
  })
}
