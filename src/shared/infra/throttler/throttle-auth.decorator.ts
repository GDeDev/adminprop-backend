import { applyDecorators } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

// Spec Fase 4: 5 intentos por minuto por IP. Una ventana más larga (antes eran
// 10 cada 15 minutos) deja afuera a una oficina entera detrás de la misma IP
// a la mañana, cuando todos se loguean; contra una cuenta puntual ya está el
// bloqueo por intentos fallidos.
const DEFAULT_TTL_SECONDS = 60
const DEFAULT_LIMIT = 5

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
 * Límite estricto para endpoints sensibles a la fuerza bruta: los dos logins y
 * el cambio de contraseña. El refresh no: su token no se puede adivinar, y
 * limitarlo cortaría las sesiones de una oficina que comparte IP.
 *
 * Por defecto: 5 intentos por minuto (`THROTTLE_AUTH_LIMIT` y
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
