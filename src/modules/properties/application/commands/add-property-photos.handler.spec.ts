import { Property, PropertyStatus } from '@/modules/properties/domain/property'
import { PropertyRepository } from '@/modules/properties/domain/property.ports'
import { StoragePort } from '@/platform/storage/storage.port'
import { PropertyViews } from '../property.views'
import { AddPropertyPhotosCommand } from './property.commands'
import { AddPropertyPhotosHandler } from './property.handlers'

const PROPERTY: Property = {
  id: 'p1',
  address: 'Calle 7 1234',
  locationId: 'l1',
  propertyTypeId: 't1',
  status: PropertyStatus.AVAILABLE,
  ownerId: null,
  amenityIds: [],
  notes: null,
  photos: [],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const photo = { buffer: Buffer.from('x'), mimeType: 'image/png' }

describe('AddPropertyPhotosHandler', () => {
  let properties: jest.Mocked<
    Pick<PropertyRepository, 'findById' | 'addPhotos'>
  >
  let storage: jest.Mocked<StoragePort>
  let handler: AddPropertyPhotosHandler

  beforeEach(() => {
    properties = {
      findById: jest.fn().mockResolvedValue(PROPERTY),
      addPhotos: jest.fn().mockResolvedValue([]),
    }
    storage = { upload: jest.fn(), delete: jest.fn() }
    const views = { detail: jest.fn().mockResolvedValue({}) }
    handler = new AddPropertyPhotosHandler(
      properties as unknown as PropertyRepository,
      storage,
      views as unknown as PropertyViews,
    )
  })

  it('si una subida falla a mitad de camino, borra las que ya subieron y no guarda nada', async () => {
    // Spec, casos borde: el array de fotos no puede quedar a medias.
    storage.upload
      .mockResolvedValueOnce({ key: 'k1', url: 'u1' })
      .mockRejectedValueOnce(new Error('Cloudinary caído'))

    await expect(
      handler.execute(new AddPropertyPhotosCommand('p1', [photo, photo])),
    ).rejects.toThrow('Cloudinary caído')

    expect(properties.addPhotos).not.toHaveBeenCalled()
    expect(storage.delete).toHaveBeenCalledWith('k1')
  })

  it('si falla el guardado en la base, borra todos los archivos subidos', async () => {
    storage.upload
      .mockResolvedValueOnce({ key: 'k1', url: 'u1' })
      .mockResolvedValueOnce({ key: 'k2', url: 'u2' })
    properties.addPhotos.mockRejectedValue(new Error('deadlock'))

    await expect(
      handler.execute(new AddPropertyPhotosCommand('p1', [photo, photo])),
    ).rejects.toThrow('deadlock')

    expect(storage.delete).toHaveBeenCalledWith('k1')
    expect(storage.delete).toHaveBeenCalledWith('k2')
  })

  it('guarda las fotos con la key y la URL que devolvió el storage', async () => {
    storage.upload.mockResolvedValue({ key: 'k1', url: 'u1' })

    await handler.execute(new AddPropertyPhotosCommand('p1', [photo]))

    expect(properties.addPhotos).toHaveBeenCalledWith('p1', [
      { storageKey: 'k1', url: 'u1' },
    ])
    expect(storage.upload.mock.calls[0][1]).toMatch(
      /^properties\/p1\/[0-9a-f-]{36}\.png$/,
    )
  })
})
