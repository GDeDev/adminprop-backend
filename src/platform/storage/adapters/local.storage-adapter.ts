import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import {
  assertKeyInTenant,
  StoragePort,
  StoredFile,
  tenantScopedKey,
} from '../storage.port'

/** Prefijo HTTP con el que `configureApp` sirve la carpeta local. */
export const LOCAL_FILES_ROUTE = '/files'

/**
 * `StoragePort` sobre el disco, para desarrollo y tests
 * (`STORAGE_PROVIDER=local`).
 *
 * Los archivos se sirven como estáticos bajo `/files` (ver `configureApp`).
 * No es para producción: no escala a varias instancias y el disco de las
 * plataformas gratuitas es efímero.
 */
export class LocalStorageAdapter extends StoragePort {
  private readonly root: string

  constructor(
    directory: string,
    private readonly publicBaseUrl: string,
  ) {
    super()
    this.root = resolve(directory)
  }

  async upload(file: Buffer, path: string): Promise<StoredFile> {
    const key = tenantScopedKey(path)
    const target = join(this.root, key)

    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file)

    return {
      key,
      url: `${this.publicBaseUrl.replace(/\/$/, '')}${LOCAL_FILES_ROUTE}/${key}`,
    }
  }

  async delete(key: string): Promise<void> {
    assertKeyInTenant(key)
    await rm(join(this.root, key), { force: true })
  }
}
