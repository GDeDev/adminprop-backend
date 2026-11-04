import { v2 as cloudinary } from 'cloudinary'

import { RequestContext } from '@/shared/context/request-context'
import { CloudinaryStorageAdapter } from './cloudinary.storage-adapter'

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload_stream: jest.fn(), destroy: jest.fn() },
    utils: { private_download_url: jest.fn() },
  },
}))

const uploader = cloudinary.uploader as unknown as {
  upload_stream: jest.Mock
  destroy: jest.Mock
}

const privateDownloadUrl = (
  cloudinary.utils as unknown as { private_download_url: jest.Mock }
).private_download_url

const inTenant = <T>(fn: () => Promise<T>) =>
  RequestContext.run({ correlationId: 'test' }, () =>
    RequestContext.runInTenant('tenant-a', fn),
  )

describe('CloudinaryStorageAdapter', () => {
  const storage = new CloudinaryStorageAdapter({
    cloudName: 'demo',
    apiKey: 'key',
    apiSecret: 'secret',
  })

  it('sube bajo la carpeta del tenant y arma la key con el tipo de recurso', async () => {
    uploader.upload_stream.mockImplementation((options, callback) => ({
      end: () =>
        callback(undefined, {
          secure_url: 'https://res.cloudinary.com/demo/raw/upload/x.pdf',
          resource_type: 'raw',
          public_id: options.public_id,
        }),
    }))

    const stored = await inTenant(() =>
      storage.upload(Buffer.from('%PDF'), 'contracts/42/contrato.pdf'),
    )

    expect(uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        public_id: 'tenants/tenant-a/contracts/42/contrato',
        resource_type: 'auto',
      }),
      expect.any(Function),
    )
    expect(stored).toEqual({
      url: 'https://res.cloudinary.com/demo/raw/upload/x.pdf',
      key: 'raw:tenants/tenant-a/contracts/42/contrato',
    })
  })

  it('borra con el tipo de recurso guardado en la key', async () => {
    // Cloudinary no encuentra un PDF si se lo borra como imagen.
    await inTenant(() =>
      storage.delete('raw:tenants/tenant-a/contracts/42/contrato'),
    )

    expect(uploader.destroy).toHaveBeenCalledWith(
      'tenants/tenant-a/contracts/42/contrato',
      expect.objectContaining({ resource_type: 'raw' }),
    )
  })

  it('no borra un archivo de otro tenant', async () => {
    await expect(
      inTenant(() => storage.delete('image:tenants/tenant-b/foto')),
    ).rejects.toThrow(/no pertenece al tenant/)
    expect(uploader.destroy).not.toHaveBeenCalled()
  })

  it('propaga el error de Cloudinary al subir', async () => {
    uploader.upload_stream.mockImplementation((_options, callback) => ({
      end: () => callback(new Error('cuota excedida')),
    }))

    await expect(
      inTenant(() => storage.upload(Buffer.from('x'), 'a.png')),
    ).rejects.toThrow('cuota excedida')
  })

  describe('archivos privados (D-196)', () => {
    it('sube como authenticated y lo marca en la key', async () => {
      uploader.upload_stream.mockImplementation((options, callback) => ({
        end: () =>
          callback(undefined, {
            secure_url: 'https://res.cloudinary.com/demo/raw/authenticated/x',
            resource_type: 'raw',
            public_id: options.public_id,
          }),
      }))

      const stored = await inTenant(() =>
        storage.upload(Buffer.from('%PDF'), 'documents/a/1-1.pdf', {
          access: 'private',
        }),
      )

      expect(uploader.upload_stream).toHaveBeenCalledWith(
        expect.objectContaining({
          public_id: 'tenants/tenant-a/documents/a/1-1.pdf',
          resource_type: 'raw',
          type: 'authenticated',
        }),
        expect.any(Function),
      )
      expect(stored.key).toBe(
        'raw:authenticated:tenants/tenant-a/documents/a/1-1.pdf',
      )
    })

    it('borra con el tipo de entrega de la key', async () => {
      await inTenant(() =>
        storage.delete(
          'raw:authenticated:tenants/tenant-a/documents/a/1-1.pdf',
        ),
      )

      expect(uploader.destroy).toHaveBeenCalledWith(
        'tenants/tenant-a/documents/a/1-1.pdf',
        expect.objectContaining({
          resource_type: 'raw',
          type: 'authenticated',
        }),
      )
    })

    it('firma la URL de un authenticated con vencimiento', () => {
      privateDownloadUrl.mockReturnValue('https://api.cloudinary.com/signed')

      const url = storage.signUrl(
        'https://res.cloudinary.com/demo/raw/authenticated/s--abc--/v12/tenants/tenant-a/documents/a/1-1.pdf',
        300,
      )

      expect(url).toBe('https://api.cloudinary.com/signed')
      expect(privateDownloadUrl).toHaveBeenCalledWith(
        'tenants/tenant-a/documents/a/1-1.pdf',
        '',
        expect.objectContaining({
          resource_type: 'raw',
          type: 'authenticated',
          expires_at: expect.any(Number),
        }),
      )
    })

    it('deja pasar sin tocar una URL pública', () => {
      const publicUrl = 'https://res.cloudinary.com/demo/image/upload/logo.png'
      expect(storage.signUrl(publicUrl)).toBe(publicUrl)
    })
  })
})
