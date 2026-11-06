import { stdSerializers } from 'pino'

/**
 * Parámetros de query que llevan credenciales. `preview` es el token (JWT de
 * 15 minutos) de la vista previa del sitio: viaja en la URL porque lo manda
 * `apps/sites`, y sin esto quedaba en cada línea de log de pino-http.
 */
export const SENSITIVE_QUERY_PARAMS = [
  'preview',
  'token',
  'access_token',
  'refresh_token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'api_key',
  'apikey',
  'password',
  'signature',
  // OAuth (callback de Mercado Libre): `code` se canjea por tokens y `state`
  // es el estado firmado; los dos quedaban en el log del callback.
  'code',
  'state',
]

const REDACTED = '[REDACTED]'

const isSensitive = (name: string) =>
  SENSITIVE_QUERY_PARAMS.includes(name.toLowerCase())

/** Reemplaza el valor de los parámetros sensibles de una URL (path + query). */
export function redactUrlQuery(url: string): string {
  const index = url.indexOf('?')
  if (index === -1) return url

  const hashIndex = url.indexOf('#', index)
  const query = url.slice(index + 1, hashIndex === -1 ? undefined : hashIndex)
  const rest = hashIndex === -1 ? '' : url.slice(hashIndex)

  const redacted = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=')
      const rawName = eq === -1 ? pair : pair.slice(0, eq)
      let name = rawName
      try {
        name = decodeURIComponent(rawName)
      } catch {
        // Nombre mal codificado: se compara tal cual.
      }
      return isSensitive(name) ? `${rawName}=${REDACTED}` : pair
    })
    .join('&')

  return `${url.slice(0, index)}?${redacted}${rest}`
}

/**
 * Serializer del request para pino-http: el estándar, pero sin credenciales en
 * `url` ni en `query`. Se hace acá y no en `REDACTED_PATHS` porque el nombre
 * del parámetro está dentro de un string, no es una ruta del objeto.
 */
export function serializeRequest(
  req: Parameters<typeof stdSerializers.req>[0],
) {
  const serialized = stdSerializers.req(req) as {
    url?: unknown
    query?: unknown
  }
  if (typeof serialized.url === 'string') {
    serialized.url = redactUrlQuery(serialized.url)
  }
  if (serialized.query && typeof serialized.query === 'object') {
    serialized.query = Object.fromEntries(
      Object.entries(serialized.query).map(([name, value]) => [
        name,
        isSensitive(name) ? REDACTED : value,
      ]),
    )
  }
  return serialized
}
