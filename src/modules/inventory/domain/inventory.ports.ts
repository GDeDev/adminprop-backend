import { IsoDate } from '@/shared/dates/calendar-date'
import { Inventory, InventoryType, ItemCondition } from './inventory'

export interface NewInventoryItem {
  category: string
  description: string
  condition: ItemCondition
  notes: string | null
  /** Las fotos que ya existen (copia de una corrección): mismo archivo. */
  photos?: { storageKey: string; url: string }[]
}

export interface NewInventory {
  contractId: string
  type: InventoryType
  date: IsoDate
  generalNotes: string | null
  performedById: string
  correctsInventoryId?: string
  correctionReason?: string
  items: NewInventoryItem[]
}

/** Un ítem de la lista que reemplaza a la actual: con `id` es uno existente. */
export interface ItemReplacement {
  id?: string
  category: string
  description: string
  condition: ItemCondition
  notes: string | null
}

export interface InventoryChanges {
  date?: IsoDate
  generalNotes?: string | null
  tenantAcknowledged?: boolean
  items?: ItemReplacement[]
}

/**
 * Puerto del repositorio de inventarios. Todo corre dentro del tenant del
 * contexto (`prisma.db`).
 */
export abstract class InventoryRepository {
  abstract create(data: NewInventory): Promise<Inventory>

  abstract findById(id: string): Promise<Inventory | null>

  /** Los vigentes del contrato (no reemplazados), del más viejo al más nuevo. */
  abstract listCurrentByContract(contractId: string): Promise<Inventory[]>

  /** El borrador de corrección que apunta a este inventario, si hay. */
  abstract findCorrectionOf(inventoryId: string): Promise<Inventory | null>

  /**
   * Aplica los cambios y, si vienen `items`, reemplaza la lista. Devuelve el
   * inventario y las claves de storage de las fotos que se fueron con los
   * ítems borrados.
   */
  abstract update(
    id: string,
    changes: InventoryChanges,
  ): Promise<{ inventory: Inventory; removedKeys: string[] }>

  abstract addPhotos(
    itemId: string,
    photos: { storageKey: string; url: string }[],
  ): Promise<void>

  abstract deletePhoto(photoId: string): Promise<void>

  /** Cuántas fotos usan ese archivo (las correcciones comparten archivos). */
  abstract countPhotosByKey(storageKey: string): Promise<number>

  /**
   * Pasa de borrador a confirmado y, si es una corrección, marca el original
   * como reemplazado, todo junto. Falso si ya no estaba en borrador.
   */
  abstract confirm(
    id: string,
    confirmedAt: Date,
    confirmedById: string,
  ): Promise<boolean>
}
