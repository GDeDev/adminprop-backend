import {
  Inventory,
  InventoryItem,
  InventoryStatus,
  InventoryType,
  ItemCondition,
} from './inventory'
import {
  changeBetween,
  compareInventories,
  InventoryChange,
} from './inventory-comparison'

let seq = 0
const item = (
  category: string,
  description: string,
  condition: ItemCondition,
  extra: Partial<InventoryItem> = {},
): InventoryItem => ({
  id: `item-${++seq}`,
  category,
  description,
  condition,
  notes: null,
  position: seq,
  photos: [],
  ...extra,
})

const inventory = (
  type: InventoryType,
  date: string,
  items: InventoryItem[],
): Inventory => ({
  id: `inv-${type}`,
  contractId: 'c',
  type,
  date,
  status: InventoryStatus.CONFIRMED,
  performedById: 'u',
  tenantAcknowledged: true,
  generalNotes: null,
  confirmedAt: new Date(),
  confirmedById: 'u',
  correctsInventoryId: null,
  correctionReason: null,
  supersededById: null,
  items,
})

const { GOOD, FAIR, POOR, NOT_APPLICABLE } = ItemCondition

describe('changeBetween', () => {
  it.each([
    [GOOD, FAIR, InventoryChange.WORSE],
    [GOOD, POOR, InventoryChange.WORSE],
    [FAIR, POOR, InventoryChange.WORSE],
    [POOR, GOOD, InventoryChange.BETTER],
    [POOR, FAIR, InventoryChange.BETTER],
    [FAIR, GOOD, InventoryChange.BETTER],
    [GOOD, GOOD, InventoryChange.SAME],
    [POOR, POOR, InventoryChange.SAME],
    [NOT_APPLICABLE, POOR, InventoryChange.SAME],
    [GOOD, NOT_APPLICABLE, InventoryChange.SAME],
    [NOT_APPLICABLE, NOT_APPLICABLE, InventoryChange.SAME],
  ])('%s -> %s es %s', (before, after, expected) => {
    expect(changeBetween(before, after)).toBe(expected)
  })
})

describe('compareInventories', () => {
  it('empareja por categoría y descripción sin distinguir mayúsculas', () => {
    const delivery = inventory(InventoryType.DELIVERY, '2026-01-01', [
      item('Cocina', 'Mesada', GOOD, {
        notes: 'impecable',
        photos: [{ id: 'p1', url: 'u1', storageKey: 'k1', position: 0 }],
      }),
      item('Pisos', 'Pisos', FAIR),
    ])
    const returned = inventory(InventoryType.RETURN, '2026-12-01', [
      item('cocina', 'mesada', POOR, {
        notes: 'quemada',
        photos: [{ id: 'p2', url: 'u2', storageKey: 'k2', position: 0 }],
      }),
      item('Pisos', 'Pisos', FAIR),
    ])

    const result = compareInventories(delivery, returned)

    expect(result.hasDelivery && result.hasReturn).toBe(true)
    expect(result.deliveryDate).toBe('2026-01-01')
    expect(result.returnDate).toBe('2026-12-01')
    expect(result.worsenedCount).toBe(1)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({
      category: 'Cocina',
      description: 'Mesada',
      deliveryCondition: GOOD,
      returnCondition: POOR,
      change: InventoryChange.WORSE,
      deliveryNotes: 'impecable',
      returnNotes: 'quemada',
      deliveryPhotos: [{ id: 'p1', url: 'u1' }],
      returnPhotos: [{ id: 'p2', url: 'u2' }],
    })
    expect(result.rows[1].change).toBe(InventoryChange.SAME)
  })

  it('marca los ítems que sólo están de un lado y los deja al final', () => {
    const delivery = inventory(InventoryType.DELIVERY, '2026-01-01', [
      item('A', 'x', GOOD),
      item('B', 'y', GOOD),
    ])
    const returned = inventory(InventoryType.RETURN, '2026-12-01', [
      item('C', 'z', FAIR),
      item('B', 'y', GOOD),
    ])
    const { rows, worsenedCount } = compareInventories(delivery, returned)
    expect(rows.map((r) => [r.category, r.change])).toEqual([
      ['A', InventoryChange.ONLY_DELIVERY],
      ['B', InventoryChange.SAME],
      ['C', InventoryChange.ONLY_RETURN],
    ])
    expect(worsenedCount).toBe(0)
  })

  it('empareja los repetidos en orden', () => {
    const delivery = inventory(InventoryType.DELIVERY, '2026-01-01', [
      item('Hab', 'Ventana', GOOD),
      item('Hab', 'Ventana', POOR),
    ])
    const returned = inventory(InventoryType.RETURN, '2026-12-01', [
      item('Hab', 'Ventana', GOOD),
      item('Hab', 'Ventana', GOOD),
    ])
    const { rows } = compareInventories(delivery, returned)
    expect(rows.map((r) => r.change)).toEqual([
      InventoryChange.SAME,
      InventoryChange.BETTER,
    ])
  })

  it('sin entrega avisa hasDelivery false y todo es sólo de la devolución', () => {
    const returned = inventory(InventoryType.RETURN, '2026-12-01', [
      item('A', 'x', POOR),
    ])
    const result = compareInventories(null, returned)
    expect(result.hasDelivery).toBe(false)
    expect(result.hasReturn).toBe(true)
    expect(result.deliveryDate).toBeNull()
    expect(result.rows[0].change).toBe(InventoryChange.ONLY_RETURN)
    expect(result.worsenedCount).toBe(0)
  })

  it('sin ninguno devuelve vacío', () => {
    expect(compareInventories(null, null)).toEqual({
      hasDelivery: false,
      hasReturn: false,
      deliveryDate: null,
      returnDate: null,
      rows: [],
      worsenedCount: 0,
    })
  })
})
