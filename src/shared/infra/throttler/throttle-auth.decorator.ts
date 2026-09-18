import { applyDecorators } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

const DEFAULT_TTL_SECONDS = 900
const DEFAULT_LIMIT = 10

/**
 * Los decoradores se evalúan al importar el módulo, y en ese momento
 * `ConfigModule` todavía no cargó los archivos `.env`: leer `process.env` acá
 * afuera devolvería siempre los defaults.
 *
 * `@nestjs/throttler` acepta `Resolvable<number>` —un valor o una función—, así
 * que resolvemos en tiempo de request, cuando el entorno ya está completo. El
 * resultado se cachea: la configuración no cambia en caliente.
 */
function lazyEnvNumber(variable: string, fallback: number): () => number {
  let cached: number | undefined

  return () => {
    if (cached !== undefined) return cached

    const raw = process.env[variable]
    const parsed = raw === undefined || raw === '' ? NaN : Number(raw)
    cached = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback

    return cached
  }
}

const resolveTtl = lazyEnvNumber('THROTTLE_AUTH_TTL', DEFAULT_TTL_SECONDS)
const resolveLimit = lazyEnvNumber('THROTTLE_AUTH_LIMIT', DEFAULT_LIMIT)

/**
 * Límite estricto para endpoints sensibles a la fuerza bruta: login, registro,
 * refresh, cambio de contraseña.
 *
 * Por defecto: 10 intentos cada 15 minutos (`THROTTLE_AUTH_LIMIT` y
 * `THROTTLE_AUTH_TTL`). Sobrescribe **los tres** perfiles globales, así un
 * atacante no puede aprovechar la ventana más permisiva.
 *
 * Se complementa con el bloqueo de cuenta de `LoginHandler`: el throttle frena
 * a una IP probando muchas cuentas; el bloqueo frena a muchas IPs probando una
 * sola cuenta.
 */
export function ThrottleAuth() {
  // El throttler espera el TTL en milisegundos; la env está en segundos.
  const ttl = () => resolveTtl() * 1000
  const limit = () => resolveLimit()

  return applyDecorators(
    Throttle({
      short: { ttl, limit },
      medium: { ttl, limit },
      long: { ttl, limit },
    }),
  )
}
