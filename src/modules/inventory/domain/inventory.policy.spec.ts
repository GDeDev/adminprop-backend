import {
  InventoryStatus,
  InventoryType,
  ItemCondition,
  MAX_ITEMS_PER_INVENTORY,
  MAX_PHOTO_BYTES,
} from './inventory'
import { InventoryPolicy } from './inventory.policy'
import { STANDARD_INVENTORY_TEMPLATE } from './inventory-template'

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheic', 'latin1'),
  Buffer.alloc(8),
])
const PDF = Buffer.from('%PDF-1.4')

const item = (condition: ItemCondition, photos = 0, description = 'Piso') => ({
  category: 'Pisos',
  description,
  condition,
  photos: Array.from({ length: photos }, () => ({})) as never[],
})

describe('InventoryPolicy', () => {
  describe('standardItems (A-43)', () => {
    const items = InventoryPolicy.standardItems()

    it('carga las nueve categorías con 2 a 5 ítems, todos en "No aplica"', () => {
      expect(STANDARD_INVENTORY_TEMPLATE).toHaveLength(9)
      for (const { descriptions } of STANDARD_INVENTORY_TEMPLATE) {
        expect(descriptions.length).toBeGreaterThanOrEqual(2)
        expect(descriptions.length).toBeLessThanOrEqual(5)
      }
      expect(
        items.every((i) => i.condition === ItemCondition.NOT_APPLICABLE),
      ).toBe(true)
      expect(new Set(items.map((i) => i.category))).toContain('Cocina')
    })
  })

  describe('normalizeDate', () => {
    it('acepta AAAA-MM-DD y rechaza el resto', () => {
      expect(InventoryPolicy.normalizeDate(' 2026-11-02 ')).toBe('2026-11-02')
      expect(() => InventoryPolicy.normalizeDate('2026-02-30')).toThrow(
        expect.objectContaining({ code: 'INVENTORY_INVALID_DATE' }),
      )
      expect(() => InventoryPolicy.normalizeDate('hoy')).toThrow()
    })
  })

  describe('normalizeItems', () => {
    it('recorta textos y vuelve null las notas vacías', () => {
      const [normalized] = InventoryPolicy.normalizeItems([
        {
          category: '  Cocina ',
          description: ' Mesada   y bacha ',
          condition: ItemCondition.GOOD,
          notes: '   ',
        },
      ])
      expect(normalized).toEqual({
        category: 'Cocina',
        description: 'Mesada y bacha',
        condition: ItemCondition.GOOD,
        notes: null,
      })
    })

    it('rechaza categoría o descripción vacías y pasarse del máximo', () => {
      const base = {
        category: 'A',
        description: 'B',
        condition: ItemCondition.GOOD,
        notes: null,
      }
      expect(() =>
        InventoryPolicy.normalizeItems([{ ...base, category: '  ' }]),
      ).toThrow(expect.objectContaining({ code: 'INVENTORY_INVALID_ITEM' }))
      expect(() =>
        InventoryPolicy.normalizeItems([{ ...base, description: '' }]),
      ).toThrow()
      expect(() =>
        InventoryPolicy.normalizeItems(
          Array.from({ length: MAX_ITEMS_PER_INVENTORY + 1 }, () => base),
        ),
      ).toThrow()
    })
  })

  describe('devolución (A-44)', () => {
    const today = '2026-11-02'

    it('con el contrato activo y lejos del fin no se habilita', () => {
      const contract = { status: 'ACTIVE', endDate: '2027-11-01' }
      expect(InventoryPolicy.canCreateReturn(contract, today)).toBe(false)
      expect(() =>
        InventoryPolicy.assertCanCreate(InventoryType.RETURN, contract, today),
      ).toThrow(
        expect.objectContaining({ code: 'INVENTORY_RETURN_NOT_ALLOWED' }),
      )
    })

    it('a 30 días del fin, o menos, sí', () => {
      expect(
        InventoryPolicy.canCreateReturn(
          { status: 'ACTIVE', endDate: '2026-12-02' },
          today,
        ),
      ).toBe(true)
      expect(
        InventoryPolicy.canCreateReturn(
          { status: 'ACTIVE', endDate: '2026-12-03' },
          today,
        ),
      ).toBe(false)
    })

    it('con el contrato finalizado o rescindido sí, aunque el fin sea lejano', () => {
      for (const status of ['FINISHED', 'TERMINATED']) {
        expect(
          InventoryPolicy.canCreateReturn(
            { status, endDate: '2030-01-01' },
            today,
          ),
        ).toBe(true)
      }
    })

    it('la entrega no depende del contrato', () => {
      expect(() =>
        InventoryPolicy.assertCanCreate(
          InventoryType.DELIVERY,
          { status: 'ACTIVE', endDate: '2030-01-01' },
          today,
        ),
      ).not.toThrow()
    })
  })

  describe('estados', () => {
    it('un confirmado no se edita', () => {
      expect(() =>
        InventoryPolicy.assertDraft({ status: InventoryStatus.CONFIRMED }),
      ).toThrow(expect.objectContaining({ code: 'INVENTORY_CONFIRMED' }))
      expect(() =>
        InventoryPolicy.assertDraft({ status: InventoryStatus.DRAFT }),
      ).not.toThrow()
    })

    it('confirmar exige un ítem evaluado', () => {
      expect(() =>
        InventoryPolicy.assertCanConfirm({
          items: [item(ItemCondition.NOT_APPLICABLE)] as never,
        }),
      ).toThrow(expect.objectContaining({ code: 'INVENTORY_EMPTY' }))
      expect(() => InventoryPolicy.assertCanConfirm({ items: [] })).toThrow()
      expect(() =>
        InventoryPolicy.assertCanConfirm({
          items: [
            item(ItemCondition.NOT_APPLICABLE),
            item(ItemCondition.FAIR),
          ] as never,
        }),
      ).not.toThrow()
    })

    it('sólo se corrige un confirmado y vigente', () => {
      expect(() =>
        InventoryPolicy.assertCanCorrect({
          status: InventoryStatus.DRAFT,
          supersededById: null,
        }),
      ).toThrow(expect.objectContaining({ code: 'INVENTORY_NOT_CONFIRMED' }))
      expect(() =>
        InventoryPolicy.assertCanCorrect({
          status: InventoryStatus.CONFIRMED,
          supersededById: 'x',
        }),
      ).toThrow(expect.objectContaining({ code: 'INVENTORY_SUPERSEDED' }))
      expect(() =>
        InventoryPolicy.assertCanCorrect({
          status: InventoryStatus.CONFIRMED,
          supersededById: null,
        }),
      ).not.toThrow()
    })
  })

  describe('warnings', () => {
    it('avisa de los ítems en mal estado sin fotos, y de nadie más', () => {
      const warnings = InventoryPolicy.warnings([
        item(ItemCondition.POOR, 0, 'Zócalos'),
        item(ItemCondition.POOR, 1, 'Pisos'),
        item(ItemCondition.FAIR, 0, 'Puertas'),
      ] as never)
      expect(warnings).toEqual([
        'Pisos · Zócalos: está en mal estado y no tiene fotos',
      ])
    })
  })

  describe('fotos', () => {
    it('reconoce JPG, PNG y HEIC por su contenido', () => {
      expect(InventoryPolicy.photoKind(JPG).extension).toBe('jpg')
      expect(InventoryPolicy.photoKind(PNG).extension).toBe('png')
      expect(InventoryPolicy.photoKind(HEIC)).toEqual({
        extension: 'heic',
        contentType: 'image/heic',
      })
    })

    it('rechaza un PDF, un archivo vacío, texto y lo que pesa más de 10 MB', () => {
      for (const file of [
        PDF,
        Buffer.alloc(0),
        Buffer.from('hola'),
        Buffer.alloc(MAX_PHOTO_BYTES + 1, 0xff),
      ]) {
        expect(() => InventoryPolicy.photoKind(file)).toThrow(
          expect.objectContaining({ code: 'INVENTORY_INVALID_PHOTO' }),
        )
      }
    })

    it('un ítem admite hasta 15 fotos', () => {
      expect(() => InventoryPolicy.assertCanAddPhotos(10, 5)).not.toThrow()
      expect(() => InventoryPolicy.assertCanAddPhotos(11, 5)).toThrow(
        expect.objectContaining({ code: 'INVENTORY_TOO_MANY_PHOTOS' }),
      )
    })
  })
})
