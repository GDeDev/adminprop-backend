import { v2 as cloudinary, UploadApiResponse } from 'cloudinary'

import {
  assertKeyInTenant,
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

/**
 * `StoragePort` sobre Cloudinary (`STORAGE_PROVIDER=cloudinary`), el proveedor
 * del MVP. Es el único archivo del proyecto que importa el SDK.
 *
 * La key es `<resource_type>:<public_id>`: Cloudinary necesita saber si el
 * archivo es imagen, video o "raw" (PDF, planillas) para poder borrarlo.
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
    _options?: UploadOptions,
  ): Promise<StoredFile> {
    const publicId = tenantScopedKey(path).replace(/\.[^/.]+$/, '')

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { public_id: publicId, resource_type: 'auto', overwrite: true },
        (error, response) => {
          if (error || !response) reject(error ?? new Error('Upload vacío'))
          else resolve(response)
        },
      )
      stream.end(file)
    })

    return {
      url: result.secure_url,
      key: `${result.resource_type}:${result.public_id}`,
    }
  }

  async delete(key: string): Promise<void> {
    const separator = key.indexOf(':')
    const resourceType = key.slice(0, separator)
    const publicId = key.slice(separator + 1)
    assertKeyInTenant(publicId)

    // `destroy` sobre un archivo que ya no existe responde "not found" sin
    // tirar: borrar es idempotente, como pide el puerto.
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    })
  }
}
