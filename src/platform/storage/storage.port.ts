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
}

export interface UploadOptions {
  contentType?: string
}

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
