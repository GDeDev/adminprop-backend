import { RequestContext } from '@/shared/context/request-context'
import {
  Inventory,
  InventoryStatus,
  InventoryType,
  ItemCondition,
} from '../domain/inventory'
import { InventoryRepository } from '../domain/inventory.ports'
import {
  AddInventoryPhotosCommand,
  CorrectInventoryCommand,
  DeleteInventoryPhotoCommand,
} from './inventory.commands'
import {
  AddInventoryPhotosHandler,
  CorrectInventoryHandler,
  DeleteInventoryPhotoHandler,
} from './inventory.handlers'

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

const inventory = (overrides: Partial<Inventory> = {}): Inventory => ({
  id: 'inv-1',
  contractId: 'contract-1',
  type: InventoryType.DELIVERY,
  date: '2026-11-02',
  status: InventoryStatus.DRAFT,
  performedById: 'user-1',
  tenantAcknowledged: false,
  generalNotes: null,
  confirmedAt: null,
  confirmedById: null,
  correctsInventoryId: null,
  correctionReason: null,
  supersededById: null,
  items: [
    {
      id: 'item-1',
      category: 'Cocina',
      description: 'Mesada',
      condition: ItemCondition.GOOD,
      notes: 'ok',
      position: 0,
      photos: [{ id: 'photo-1', url: 'u1', storageKey: 'k1', position: 0 }],
    },
  ],
  ...overrides,
})

describe('inventory handlers', () => {
  let repo: jest.Mocked<InventoryRepository>
  let storage: { upload: jest.Mock; delete: jest.Mock }
  let audit: { record: jest.Mock }
  let views: { detail: jest.Mock }

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      listCurrentByContract: jest.fn(),
      findCorrectionOf: jest.fn(),
      update: jest.fn(),
      addPhotos: jest.fn(),
      deletePhoto: jest.fn(),
      countPhotosByKey: jest.fn(),
      confirm: jest.fn(),
    } as unknown as jest.Mocked<InventoryRepository>
    storage = {
      upload: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    }
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    views = { detail: jest.fn((value: Inventory) => Promise.resolve(value)) }
  })

  const asUser = <T>(fn: () => Promise<T>) =>
    RequestContext.run(
      { correlationId: 't', userId: 'user-2', tenantId: 'ten-1' },
      fn,
    )

  describe('AddInventoryPhotosHandler', () => {
    const handler = () =>
      new AddInventoryPhotosHandler(
        repo,
        storage as never,
        audit as never,
        views as never,
      )

    it('no sube nada si una de las fotos no es una imagen', async () => {
      repo.findById.mockResolvedValue(inventory())
      await expect(
        asUser(() =>
          handler().execute(
            new AddInventoryPhotosCommand('inv-1', 'item-1', [
              JPG,
              Buffer.from('%PDF-1.4'),
            ]),
          ),
        ),
      ).rejects.toMatchObject({ code: 'INVENTORY_INVALID_PHOTO' })
      expect(storage.upload).not.toHaveBeenCalled()
    })

    it('si falla una subida, borra las que ya subió y no guarda filas', async () => {
      repo.findById.mockResolvedValue(inventory())
      storage.upload
        .mockResolvedValueOnce({ key: 'new-1', url: 'n1' })
        .mockRejectedValueOnce(new Error('storage caído'))
      await expect(
        asUser(() =>
          handler().execute(
            new AddInventoryPhotosCommand('inv-1', 'item-1', [JPG, JPG]),
          ),
        ),
      ).rejects.toThrow('storage caído')
      expect(storage.delete).toHaveBeenCalledWith('new-1')
      expect(repo.addPhotos).not.toHaveBeenCalled()
    })

    it('sube a una ruta con el tenant y el inventario, y audita', async () => {
      repo.findById.mockResolvedValue(inventory())
      storage.upload.mockResolvedValue({ key: 'new-1', url: 'n1' })
      await asUser(() =>
        handler().execute(
          new AddInventoryPhotosCommand('inv-1', 'item-1', [JPG]),
        ),
      )
      expect(storage.upload.mock.calls[0][1]).toMatch(
        /^inventories\/ten-1\/inv-1\/[0-9a-f-]+\.jpg$/,
      )
      expect(repo.addPhotos).toHaveBeenCalledWith('item-1', [
        { storageKey: 'new-1', url: 'n1' },
      ])
      expect(audit.record).toHaveBeenCalled()
    })

    it('rechaza un borrador confirmado, un ítem ajeno y pasarse de 15', async () => {
      repo.findById.mockResolvedValue(
        inventory({ status: InventoryStatus.CONFIRMED }),
      )
      await expect(
        asUser(() =>
          handler().execute(
            new AddInventoryPhotosCommand('inv-1', 'item-1', [JPG]),
          ),
        ),
      ).rejects.toMatchObject({ code: 'INVENTORY_CONFIRMED' })

      repo.findById.mockResolvedValue(inventory())
      await expect(
        asUser(() =>
          handler().execute(
            new AddInventoryPhotosCommand('inv-1', 'otro', [JPG]),
          ),
        ),
      ).rejects.toMatchObject({ code: 'INVENTORY_ITEM_NOT_FOUND' })

      const full = inventory()
      full.items[0].photos = Array.from({ length: 15 }, (_, i) => ({
        id: `p${i}`,
        url: 'u',
        storageKey: `k${i}`,
        position: i,
      }))
      repo.findById.mockResolvedValue(full)
      await expect(
        asUser(() =>
          handler().execute(
            new AddInventoryPhotosCommand('inv-1', 'item-1', [JPG]),
          ),
        ),
      ).rejects.toMatchObject({ code: 'INVENTORY_TOO_MANY_PHOTOS' })
    })
  })

  describe('DeleteInventoryPhotoHandler', () => {
    const handler = () =>
      new DeleteInventoryPhotoHandler(
        repo,
        storage as never,
        audit as never,
        views as never,
      )

    it('borra el archivo cuando ninguna otra foto lo usa', async () => {
      repo.findById.mockResolvedValue(inventory())
      repo.countPhotosByKey.mockResolvedValue(0)
      await asUser(() =>
        handler().execute(new DeleteInventoryPhotoCommand('inv-1', 'photo-1')),
      )
      expect(repo.deletePhoto).toHaveBeenCalledWith('photo-1')
      expect(storage.delete).toHaveBeenCalledWith('k1')
    })

    it('conserva el archivo si una corrección lo comparte', async () => {
      repo.findById.mockResolvedValue(inventory())
      repo.countPhotosByKey.mockResolvedValue(1)
      await asUser(() =>
        handler().execute(new DeleteInventoryPhotoCommand('inv-1', 'photo-1')),
      )
      expect(storage.delete).not.toHaveBeenCalled()
    })

    it('404 si la foto no es de ese inventario', async () => {
      repo.findById.mockResolvedValue(inventory())
      await expect(
        asUser(() =>
          handler().execute(new DeleteInventoryPhotoCommand('inv-1', 'ajena')),
        ),
      ).rejects.toMatchObject({ code: 'INVENTORY_PHOTO_NOT_FOUND' })
    })
  })

  describe('CorrectInventoryHandler', () => {
    const handler = () => new CorrectInventoryHandler(repo, views as never)
    const confirmed = () =>
      inventory({ status: InventoryStatus.CONFIRMED, tenantAcknowledged: true })

    it('copia ítems y fotos en un borrador nuevo con el motivo', async () => {
      repo.findById.mockResolvedValue(confirmed())
      repo.findCorrectionOf.mockResolvedValue(null)
      repo.create.mockImplementation((data) =>
        Promise.resolve(inventory({ id: 'inv-2', ...data } as never)),
      )
      await asUser(() =>
        handler().execute(
          new CorrectInventoryCommand('inv-1', '  Error de carga '),
        ),
      )
      const data = repo.create.mock.calls[0][0]
      expect(data).toMatchObject({
        contractId: 'contract-1',
        type: InventoryType.DELIVERY,
        correctsInventoryId: 'inv-1',
        correctionReason: 'Error de carga',
        performedById: 'user-2',
      })
      expect(data.items).toEqual([
        {
          category: 'Cocina',
          description: 'Mesada',
          condition: ItemCondition.GOOD,
          notes: 'ok',
          photos: [{ storageKey: 'k1', url: 'u1' }],
        },
      ])
    })

    it('409 si ya hay una corrección en borrador', async () => {
      repo.findById.mockResolvedValue(confirmed())
      repo.findCorrectionOf.mockResolvedValue(inventory({ id: 'inv-2' }))
      await expect(
        asUser(() =>
          handler().execute(new CorrectInventoryCommand('inv-1', 'otra vez')),
        ),
      ).rejects.toMatchObject({ code: 'INVENTORY_CORRECTION_PENDING' })
    })

    it('409 si el original está en borrador o ya fue reemplazado', async () => {
      repo.findById.mockResolvedValue(inventory())
      await expect(
        asUser(() =>
          handler().execute(new CorrectInventoryCommand('inv-1', 'x y z')),
        ),
      ).rejects.toMatchObject({ code: 'INVENTORY_NOT_CONFIRMED' })
      repo.findById.mockResolvedValue({
        ...confirmed(),
        supersededById: 'inv-9',
      })
      await expect(
        asUser(() =>
          handler().execute(new CorrectInventoryCommand('inv-1', 'x y z')),
        ),
      ).rejects.toMatchObject({ code: 'INVENTORY_SUPERSEDED' })
    })
  })
})
