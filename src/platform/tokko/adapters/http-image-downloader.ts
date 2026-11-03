import { isIP } from 'node:net'

import {
  ALLOWED_IMAGE_TYPES,
  DownloadedImage,
  ImageDownloadError,
  ImageDownloaderPort,
  MAX_IMAGE_BYTES,
} from '../image-downloader.port'

const TIMEOUT_MS = 15_000
const RETRIES = 2

export interface HttpImageDownloaderOptions {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

/** Direcciones que una URL de foto jamás debería apuntar (SSRF). */
function isInternalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.internal') || host.endsWith('.local')) return true
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number)
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (isIP(host) === 6) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd')
  }
  return false
}

/**
 * Descarga real de las fotos. Sólo http(s) hacia hosts públicos: la URL sale
 * de un sistema externo y no se confía en ella.
 */
export class HttpImageDownloader extends ImageDownloaderPort {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly timeoutMs: number

  constructor(options: HttpImageDownloaderOptions = {}) {
    super()
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  }

  async download(url: string): Promise<DownloadedImage> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new ImageDownloadError('La URL de la foto no es válida')
    }
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      isInternalHost(parsed.hostname)
    ) {
      throw new ImageDownloadError('La URL de la foto no es pública')
    }

    let lastError = new ImageDownloadError('No se pudo descargar la foto')
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      try {
        return await this.once(parsed)
      } catch (error) {
        lastError =
          error instanceof ImageDownloadError
            ? error
            : new ImageDownloadError('No se pudo descargar la foto')
        // Un 404 o un archivo que no es imagen no mejoran reintentando.
        if (!isTransient(lastError)) break
        if (attempt < RETRIES) await this.sleep(500 * 2 ** attempt)
      }
    }
    throw lastError
  }

  private async once(url: URL): Promise<DownloadedImage> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'follow',
      })
    } catch {
      throw new TransientImageError('La foto no respondió a tiempo')
    }
    if (response.status >= 500 || response.status === 429) {
      throw new TransientImageError(`El servidor respondió ${response.status}`)
    }
    if (!response.ok) {
      throw new ImageDownloadError(`La foto no existe (${response.status})`)
    }

    const mimeType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
      throw new ImageDownloadError(
        'El archivo no es una imagen JPG, PNG o WEBP',
      )
    }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_IMAGE_BYTES) {
      throw new ImageDownloadError('La foto pesa más de 10 MB')
    }

    let buffer: Buffer
    try {
      buffer = Buffer.from(await response.arrayBuffer())
    } catch {
      throw new TransientImageError('Se cortó la descarga de la foto')
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new ImageDownloadError('La foto pesa más de 10 MB')
    }
    if (buffer.length === 0) {
      throw new ImageDownloadError('La foto está vacía')
    }
    return { buffer, mimeType: mimeType as DownloadedImage['mimeType'] }
  }
}

class TransientImageError extends ImageDownloadError {}

const isTransient = (error: ImageDownloadError): boolean =>
  error instanceof TransientImageError
