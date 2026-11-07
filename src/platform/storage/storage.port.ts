import { RequestContext } from '@/shared/context/request-context'

/**
 * Almacenamiento de archivos (spec Fase 1, sección 5.2).
 *
 * Hoy `local` (desarrollo) o Cloudinary; mañana, S3. Quien sube un archivo
 * sólo conoce este puerto: ningún módulo de negocio importa un SDK de storage.
 *
 * Clase abstracta y no interface para usarla como token de inyección.
 */
export abstract class StoragePort {
  /**
   * Sube un archivo. `path` es relativo al tenant del contexto: el adapter lo
   * guarda bajo `tenants/<tenantId>/`, así los archivos de dos inmobiliarias
   * nunca comparten carpeta.
   */
  abstract upload(
    file: Buffer,
    path: string,
    options?: UploadOptions,
  ): Promise<StoredFile>

  /** Borra un archivo por la `key` que devolvió `upload`. Idempotente. */
  abstract delete(key: string): Promise<void>

  /**
   * Baja el contenido de un archivo propio (para adjuntarlo a un mail). Recibe
   * la `key` y la `url` que devolvió `upload`: el disco usa la key, un CDN la
   * url. Falla si el archivo no existe o no es del tenant del contexto.
   */
  abstract download(key: string, url: string): Promise<Buffer>

  /**
   * Devuelve una URL con la que se puede abrir el archivo ahora. Para un
   * archivo `private` es una URL firmada que vence a los `ttlSeconds`; para uno
   * público (o en disco local) devuelve la misma URL. Es síncrona y no falla:
   * una URL ajena o ya pública pasa sin cambios.
   */
  abstract signUrl(url: string, ttlSeconds?: number): string
}

export interface UploadOptions {
  contentType?: string
  /**
   * `private`: sólo se llega al archivo con una URL firmada de corta vida
   * (`signUrl`). Para PDFs de liquidaciones y comprobantes, que llevan montos y
   * datos bancarios (D-196). Por defecto `public` (fotos, logo).
   */
  access?: 'public' | 'private'
}

/** Vida de una URL firmada: alcanza para abrirla, no para reenviarla. */
export const SIGNED_URL_TTL_SECONDS = 600

export interface StoredFile {
  /** URL pública para mostrar o descargar el archivo. */
  url: string
  /**
   * Identificador estable del archivo en el proveedor. Es lo que se guarda en
   * la base para poder borrarlo después: la URL puede cambiar (CDN, dominio).
   */
  key: string
}

/** Un `path` con `..` o absoluto podría escapar de la carpeta del tenant. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

/**
 * Arma la key del archivo dentro del tenant del contexto. La comparten todos
 * los adapters. Falla sin tenant, igual que el filtro de Prisma.
 */
export function tenantScopedKey(path: string): string {
  const tenantId = RequestContext.tenantId
  if (!tenantId) {
    throw new Error(
      'StoragePort sin tenant en el contexto: envolvé la llamada en RequestContext.runInTenant()',
    )
  }

  const segments = path.split('/').filter(Boolean)
  if (
    segments.length === 0 ||
    segments.some((s) => !SAFE_SEGMENT.test(s) || s === '..' || s === '.')
  ) {
    throw new Error(`Path de archivo inválido: "${path}"`)
  }

  return ['tenants', tenantId, ...segments].join('/')
}

/** La key pertenece al tenant del contexto. Evita borrar archivos ajenos. */
export function assertKeyInTenant(key: string): void {
  const tenantId = RequestContext.tenantId
  if (!tenantId || !key.startsWith(`tenants/${tenantId}/`)) {
    throw new Error('La key del archivo no pertenece al tenant del contexto')
  }
}
