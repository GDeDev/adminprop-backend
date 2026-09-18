/**
 * Claves cuyo valor jamás debe llegar a un log.
 * La comparación es por substring, en minúsculas: `password` matchea
 * `password`, `newPassword`, `password_confirmation`, etc.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'auth',
  'cookie',
  'session',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'privatekey',
  'private_key',
  'credential',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'ssn',
  'pin',
  'otp',
  'signature',
]

export const REDACTED = '[REDACTED]'

const MAX_DEPTH = 6
const MAX_ARRAY_ITEMS = 25
const MAX_STRING_LENGTH = 2000

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '')
  return SENSITIVE_KEYS.some((sensitive) =>
    normalized.includes(sensitive.replace(/[-_]/g, '')),
  )
}

/**
 * Devuelve una copia del valor con los campos sensibles reemplazados por
 * `[REDACTED]`, acotando profundidad, arrays y strings largas para que un
 * payload grande no inunde los logs.
 *
 * Es defensiva a propósito: si algo no se puede serializar, devuelve un
 * marcador en vez de tirar una excepción dentro del logger.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value

  if (depth > MAX_DEPTH) return '[Object: profundidad máxima]'

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}… [+${value.length - MAX_STRING_LENGTH} caracteres]`
      : value
  }

  if (typeof value !== 'object') return value

  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return { name: value.name, message: value.message }
  }
  if (Buffer.isBuffer(value)) return `[Buffer: ${value.length} bytes]`

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((v) => redact(v, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`… [+${value.length - MAX_ARRAY_ITEMS} elementos]`)
    }
    return items
  }

  const output: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1)
  }
  return output
}

/** Redacta headers HTTP (cookie, authorization y compañía). */
export function redactHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!headers) return {}
  return redact(headers) as Record<string, unknown>
}
