import { errorMessage } from '@/shared/core/error-message'
import { IndexSourceUnavailableError } from '../index-source.port'

/** Cuánto espera una fuente pública antes de darla por caída. */
const TIMEOUT_MS = 15_000

/**
 * GET que devuelve JSON, con timeout. Cualquier falla (red, HTTP no 2xx,
 * cuerpo que no es JSON) sale como `IndexSourceUnavailableError` con el
 * nombre de la fuente, para que el job la registre sin adivinar.
 */
export async function getJson(source: string, url: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new IndexSourceUnavailableError(
      source,
      `no se pudo conectar (${errorMessage(error)})`,
    )
  }
  if (!response.ok) {
    throw new IndexSourceUnavailableError(
      source,
      `respondió HTTP ${response.status}`,
    )
  }
  try {
    return await response.json()
  } catch {
    throw new IndexSourceUnavailableError(
      source,
      'la respuesta no es JSON: la fuente cambió de formato',
    )
  }
}
