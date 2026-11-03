import { DownloadedImage, ImageDownloaderPort } from '../image-downloader.port'

/** PNG de 1x1 píxel, válido. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * Con `TOKKO_SOURCE=fixture` las URLs de las fotos son inventadas: en vez de
 * fallar en la red, devuelve una imagen mínima para ver el flujo completo.
 */
export class FixtureImageDownloader extends ImageDownloaderPort {
  download(): Promise<DownloadedImage> {
    return Promise.resolve({ buffer: PIXEL_PNG, mimeType: 'image/png' })
  }
}
