import { v2 as cloudinary, UploadApiResponse } from 'cloudinary'

import {
  assertKeyInTenant,
  SIGNED_URL_TTL_SECONDS,
  StoragePort,
  StoredFile,
  tenantScopedKey,
  UploadOptions,
} from '../storage.port'

export interface CloudinaryCredentials {
  cloudName: string
  apiKey: string
  apiSecret: string
}

/** Un asset `authenticated`: `…/<image|raw|video>/authenticated/[s--sig--/][v123/]<public_id>`. */
const AUTHENTICATED_URL =
  /^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/authenticated\/(?:s--[^/]+--\/)?(?:v\d+\/)?(.+)$/

interface ParsedKey {
  resourceType: string
  deliveryType: 'upload' | 'authenticated'
  publicId: string
}

/**
 * `StoragePort` sobre Cloudinary (`STORAGE_PROVIDER=cloudinary`), el proveedor
 * del MVP. Es el único archivo del proyecto que importa el SDK.
 *
 * La key es `<resource_type>:<public_id>` para archivos públicos y
 * `<resource_type>:authenticated:<public_id>` para los privados: Cloudinary
 * necesita saber el tipo de recurso y el de entrega para poder borrarlos.
 */
export class CloudinaryStorageAdapter extends StoragePort {
  constructor(credentials: CloudinaryCredentials) {
    super()
    cloudinary.config({
      cloud_name: credentials.cloudName,
      api_key: credentials.apiKey,
      api_secret: credentials.apiSecret,
      secure: true,
    })
  }

  async upload(
    file: Buffer,
    path: string,
    options?: UploadOptions,
  ): Promise<StoredFile> {
    const isPrivate = options?.access === 'private'
    // Un privado se sube como `raw` y conserva la extensión en el public_id:
    // así la URL firmada no depende de un `format` que Cloudinary infiere.
    const publicId = isPrivate
      ? tenantScopedKey(path)
      : tenantScopedKey(path).replace(/\.[^/.]+$/, '')

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        isPrivate
          ? {
              public_id: publicId,
              resource_type: 'raw',
              type: 'authenticated',
              overwrite: true,
            }
          : { public_id: publicId, resource_type: 'auto', overwrite: true },
        (error, response) => {
          if (error || !response) reject(error ?? new Error('Upload vacío'))
          else resolve(response)
        },
      )
      stream.end(file)
    })

    return {
      url: result.secure_url,
      key: isPrivate
        ? `${result.resource_type}:authenticated:${result.public_id}`
        : `${result.resource_type}:${result.public_id}`,
    }
  }

  async download(key: string, url: string): Promise<Buffer> {
    assertKeyInTenant(this.parseKey(key).publicId)
    const response = await fetch(this.signUrl(url, 60))
    if (!response.ok) {
      throw new Error(`No se pudo bajar el archivo (${response.status})`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  signUrl(url: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): string {
    const match = AUTHENTICATED_URL.exec(url)
    if (!match) return url

    const [, resourceType, rawPublicId] = match
    return cloudinary.utils.private_download_url(
      decodeURIComponent(rawPublicId),
      '',
      {
        resource_type: resourceType,
        type: 'authenticated',
        expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    )
  }

  async delete(key: string): Promise<void> {
    const { resourceType, deliveryType, publicId } = this.parseKey(key)
    assertKeyInTenant(publicId)

    // `destroy` sobre un archivo que ya no existe responde "not found" sin
    // tirar: borrar es idempotente, como pide el puerto.
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: deliveryType,
      invalidate: true,
    })
  }

  private parseKey(key: string): ParsedKey {
    const [resourceType, second, ...rest] = key.split(':')
    if (second === 'authenticated' && rest.length > 0) {
      return {
        resourceType,
        deliveryType: 'authenticated',
        publicId: rest.join(':'),
      }
    }
    return {
      resourceType,
      deliveryType: 'upload',
      publicId: [second, ...rest].join(':'),
    }
  }
}
