import { IsoDate } from '@/shared/dates/calendar-date'

export enum InventoryType {
  DELIVERY = 'DELIVERY',
  RETURN = 'RETURN',
}

export enum InventoryStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
}

export enum ItemCondition {
  GOOD = 'GOOD',
  FAIR = 'FAIR',
  POOR = 'POOR',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

/** 10 MB por foto, igual que los comprobantes. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
/** Fotos por pedido. */
export const MAX_PHOTOS_PER_UPLOAD = 5
/** Fotos por ítem. */
export const MAX_PHOTOS_PER_ITEM = 15
/** Ítems por inventario: frena abusos, una casa grande no llega ni a la mitad. */
export const MAX_ITEMS_PER_INVENTORY = 300
/** Con un RETURN se puede empezar hasta 30 días antes del fin (A-44). */
export const RETURN_WINDOW_DAYS = 30

export interface InventoryPhoto {
  id: string
  url: string
  storageKey: string
  position: number
}

export interface InventoryItem {
  id: string
  category: string
  description: string
  condition: ItemCondition
  notes: string | null
  position: number
  photos: InventoryPhoto[]
}

/**
 * Acta de entrega o devolución de un contrato. Confirmada no cambia más: una
 * corrección es otro inventario que, al confirmarse, la reemplaza.
 */
export interface Inventory {
  id: string
  contractId: string
  type: InventoryType
  date: IsoDate
  status: InventoryStatus
  performedById: string
  tenantAcknowledged: boolean
  generalNotes: string | null
  confirmedAt: Date | null
  confirmedById: string | null
  correctsInventoryId: string | null
  correctionReason: string | null
  /** La corrección confirmada que lo reemplazó; null = vigente. */
  supersededById: string | null
  items: InventoryItem[]
}

export function isConfirmed(inventory: Pick<Inventory, 'status'>): boolean {
  return inventory.status === InventoryStatus.CONFIRMED
}
