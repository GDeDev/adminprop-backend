/**
 * Descarga de las fotos de Tokko para migrarlas al storage propio (Fase 21,
 * 4.4). Puerto aparte de `TokkoSourcePort`: se prueba con un fake que simula
 * éxito, timeout y 404 sin tocar la red.
 */
export abstract class ImageDownloaderPort {
  /**
   * Baja una imagen jpeg/png/webp de hasta 10 MB, con timeout de 15 s y dos
   * reintentos.
   *
   * @throws ImageDownloadError con un mensaje en español listo para mostrar.
   */
  abstract download(url: string): Promise<DownloadedImage>
}

export interface DownloadedImage {
  buffer: Buffer
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export class ImageDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageDownloadError'
  }
}
