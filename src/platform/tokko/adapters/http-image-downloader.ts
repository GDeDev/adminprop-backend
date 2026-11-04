import { lookup } from 'node:dns/promises'
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
/** Redirecciones que se siguen a mano; cada salto se vuelve a validar. */
const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface HttpImageDownloaderOptions {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  /** Direcciones IP de un nombre de host (por defecto, el DNS del sistema). */
  resolveHost?: (hostname: string) => Promise<string[]>
}

const defaultResolveHost = async (hostname: string): Promise<string[]> =>
  (await lookup(hostname, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  )

/** IPv4 que nunca debería ser el destino de la foto de un sistema externo. */
function isInternalIpv4(address: string): boolean {
  const [a, b, c] = address.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast y reservadas
  )
}

/** Los 16 bytes de una IPv6 (acepta `::` y la cola IPv4 de `::ffff:1.2.3.4`). */
function ipv6Bytes(address: string): number[] | null {
  let text = address.toLowerCase().split('%')[0]
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (tail) {
    const [a, b, c, d] = tail[1].split('.').map(Number)
    text =
      text.slice(0, -tail[1].length) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, rest, ...extra] = text.split('::')
  if (extra.length > 0) return null
  const left = head === '' ? [] : head.split(':')
  const right = rest === undefined || rest === '' ? [] : rest.split(':')
  const missing = 8 - left.length - right.length
  if (rest === undefined ? left.length !== 8 : missing < 1) return null
  const groups = [
    ...left,
    ...(rest === undefined ? [] : Array<string>(missing).fill('0')),
    ...right,
  ]
  const bytes: number[] = []
  for (const group of groups) {
    const value = parseInt(group, 16)
    if (!/^[0-9a-f]{1,4}$/.test(group) || Number.isNaN(value)) return null
    bytes.push(value >> 8, value & 0xff)
  }
  return bytes
}

function isInternalIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address)
  if (!bytes) return true // lo que no se entiende, no se sigue
  const embedded = () => bytes.slice(12).join('.')
  if (bytes.every((byte) => byte === 0)) return true // ::
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) {
    return true // ::1
  }
  // ::ffff:a.b.c.d (IPv4 mapeada) y 64:ff9b::a.b.c.d (NAT64): vale la IPv4.
  const mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  const nat64 =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  if (mapped || nat64) return isInternalIpv4(embedded())
  if ((bytes[0] & 0xfe) === 0xfc) return true // fc00::/7 (únicas locales)
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true // fe80::/10
  if (bytes[0] === 0xff) return true // multicast
  return false
}

/** Si la dirección (IPv4 o IPv6) es de la red interna o reservada. */
export function isInternalAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isInternalIpv4(address)
  if (version === 6) return isInternalIpv6(address)
  return true
}

/** Nombres que ya delatan un destino interno, sin resolver nada. */
function isInternalHost(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.internal') || host.endsWith('.local')) return true
  return isIP(host) !== 0 && isInternalAddress(host)
}

/**
 * Descarga real de las fotos. Sólo http(s) hacia hosts públicos: la URL sale
 * de un sistema externo y no se confía en ella. Se valida el host de la URL,
 * lo que resuelve el DNS y cada redirección (un `302` a la red interna era la
 * forma de saltear el chequeo).
 */
export class HttpImageDownloader extends ImageDownloaderPort {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly timeoutMs: number
  private readonly resolveHost: (hostname: string) => Promise<string[]>

  constructor(options: HttpImageDownloaderOptions = {}) {
    super()
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS
    this.resolveHost = options.resolveHost ?? defaultResolveHost
  }

  async download(url: string): Promise<DownloadedImage> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new ImageDownloadError('La URL de la foto no es válida')
    }
    await this.assertPublic(parsed)

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

  /**
   * Sólo http(s) hacia una dirección pública. Un nombre se resuelve y se
   * rechaza si alguna de sus direcciones es interna (un dominio propio puede
   * apuntar a 127.0.0.1). Queda abierta la ventana entre esta resolución y la
   * conexión del `fetch` (DNS rebinding).
   */
  private async assertPublic(url: URL): Promise<void> {
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      isInternalHost(url.hostname)
    ) {
      throw new ImageDownloadError('La URL de la foto no es pública')
    }
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) !== 0) return
    let addresses: string[]
    try {
      addresses = await this.resolveHost(host)
    } catch {
      throw new ImageDownloadError('No se pudo resolver el sitio de la foto')
    }
    if (addresses.length === 0 || addresses.some(isInternalAddress)) {
      throw new ImageDownloadError('La URL de la foto no es pública')
    }
  }

  /** GET que sigue las redirecciones a mano, validando cada destino. */
  private async fetchFollowing(first: URL): Promise<Response> {
    let url = first
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: 'manual',
        })
      } catch {
        throw new TransientImageError('La foto no respondió a tiempo')
      }
      if (!REDIRECT_STATUSES.has(response.status)) return response

      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location) {
        throw new ImageDownloadError('La foto redirige a ningún lado')
      }
      try {
        url = new URL(location, url)
      } catch {
        throw new ImageDownloadError('La URL de la foto no es válida')
      }
      await this.assertPublic(url)
    }
    throw new ImageDownloadError('La foto redirige demasiadas veces')
  }

  private async once(url: URL): Promise<DownloadedImage> {
    const response = await this.fetchFollowing(url)
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
