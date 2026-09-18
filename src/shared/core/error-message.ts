/**
 * Extrae un mensaje legible de algo capturado en un `catch`.
 *
 * Con `strict` activado, lo que llega a un `catch` es `unknown` y no `any`: en
 * JavaScript se puede lanzar cualquier cosa, no sólo `Error`. Este helper evita
 * el `error.message` que explotaba con un `throw 'texto'` o un `throw { code }`.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }

  return String(error)
}

/** Stack del error si lo tiene. Para pasarle a `CustomLoggerService.error()`. */
export function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined
}
