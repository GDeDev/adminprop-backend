import { DomainException } from '@/shared/errors'
import { ImageDownloadError } from '@/platform/tokko/image-downloader.port'
import { TokkoSourceError } from '@/platform/tokko/tokko-source.port'

/**
 * Mensaje en español para mostrar de una falla en una fila o foto. Las
 * excepciones de dominio, la fuente de Tokko y la descarga ya traen el suyo;
 * cualquier otra cosa es un error inesperado y no se filtra al usuario.
 */
export function userMessage(error: unknown): { code: string; message: string } {
  if (error instanceof DomainException) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof TokkoSourceError) {
    return { code: 'TOKKO_ERROR', message: error.message }
  }
  if (error instanceof ImageDownloadError) {
    return { code: 'IMAGE_DOWNLOAD_FAILED', message: error.message }
  }
  return {
    code: 'UNEXPECTED_ERROR',
    message: 'Ocurrió un error inesperado al procesar esta fila',
  }
}
