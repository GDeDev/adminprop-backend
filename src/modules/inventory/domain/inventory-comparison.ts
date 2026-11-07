import { IsoDate } from '@/shared/dates/calendar-date'
import { Inventory, InventoryItem, ItemCondition } from './inventory'

export enum InventoryChange {
  WORSE = 'WORSE',
  BETTER = 'BETTER',
  SAME = 'SAME',
  ONLY_DELIVERY = 'ONLY_DELIVERY',
  ONLY_RETURN = 'ONLY_RETURN',
}

export interface ComparisonPhoto {
  id: string
  url: string
}

export interface ComparisonRow {
  category: string
  description: string
  deliveryCondition: ItemCondition | null
  returnCondition: ItemCondition | null
  change: InventoryChange
  deliveryNotes: string | null
  returnNotes: string | null
  deliveryPhotos: ComparisonPhoto[]
  returnPhotos: ComparisonPhoto[]
}

export interface InventoryComparison {
  hasDelivery: boolean
  hasReturn: boolean
  deliveryDate: IsoDate | null
  returnDate: IsoDate | null
  rows: ComparisonRow[]
  worsenedCount: number
}

/** `GOOD < FAIR < POOR`; "No aplica" no entra en el orden. */
const RANK: Partial<Record<ItemCondition, number>> = {
  [ItemCondition.GOOD]: 0,
  [ItemCondition.FAIR]: 1,
  [ItemCondition.POOR]: 2,
}

const keyOf = (item: Pick<InventoryItem, 'category' | 'description'>) =>
  `${item.category.trim().toLowerCase()}|${item.description.trim().toLowerCase()}`

const photosOf = (item: InventoryItem | undefined): ComparisonPhoto[] =>
  (item?.photos ?? []).map(({ id, url }) => ({ id, url }))

/**
 * Cambio entre el estado de entrega y el de devolución. Si alguno de los dos
 * es "No aplica" no hay con qué comparar: cuenta como igual.
 */
export function changeBetween(
  delivery: ItemCondition,
  returned: ItemCondition,
): InventoryChange {
  const before = RANK[delivery]
  const after = RANK[returned]
  if (before === undefined || after === undefined) return InventoryChange.SAME
  if (after > before) return InventoryChange.WORSE
  if (after < before) return InventoryChange.BETTER
  return InventoryChange.SAME
}

/**
 * Compara los dos inventarios vigentes de un contrato. Los ítems se emparejan
 * por categoría y descripción (sin distinguir mayúsculas); si hay repetidos
 * se emparejan en orden. Primero van los de la entrega, después los que sólo
 * aparecen en la devolución.
 */
export function compareInventories(
  delivery: Inventory | null,
  returned: Inventory | null,
): InventoryComparison {
  const pending = new Map<string, InventoryItem[]>()
  for (const item of returned?.items ?? []) {
    const queue = pending.get(keyOf(item)) ?? []
    queue.push(item)
    pending.set(keyOf(item), queue)
  }
  const matched = new Set<string>()

  const rows: ComparisonRow[] = (delivery?.items ?? []).map((item) => {
    const counterpart = pending.get(keyOf(item))?.shift()
    if (counterpart) matched.add(counterpart.id)
    return {
      category: item.category,
      description: item.description,
      deliveryCondition: item.condition,
      returnCondition: counterpart?.condition ?? null,
      change: counterpart
        ? changeBetween(item.condition, counterpart.condition)
        : InventoryChange.ONLY_DELIVERY,
      deliveryNotes: item.notes,
      returnNotes: counterpart?.notes ?? null,
      deliveryPhotos: photosOf(item),
      returnPhotos: photosOf(counterpart),
    }
  })

  for (const item of returned?.items ?? []) {
    if (matched.has(item.id)) continue
    rows.push({
      category: item.category,
      description: item.description,
      deliveryCondition: null,
      returnCondition: item.condition,
      change: InventoryChange.ONLY_RETURN,
      deliveryNotes: null,
      returnNotes: item.notes,
      deliveryPhotos: [],
      returnPhotos: photosOf(item),
    })
  }

  return {
    hasDelivery: delivery !== null,
    hasReturn: returned !== null,
    deliveryDate: delivery?.date ?? null,
    returnDate: returned?.date ?? null,
    rows,
    worsenedCount: rows.filter((row) => row.change === InventoryChange.WORSE)
      .length,
  }
}
