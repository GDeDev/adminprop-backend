import {
  daysBetween,
  IsoDate,
  isValidIsoDate,
} from '@/shared/dates/calendar-date'
import { detectFileKind } from '@/shared/files/file-signature'
import {
  Inventory,
  InventoryItem,
  InventoryStatus,
  InventoryType,
  ItemCondition,
  MAX_ITEMS_PER_INVENTORY,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_ITEM,
  RETURN_WINDOW_DAYS,
} from './inventory'
import {
  InvalidInventoryDateException,
  InvalidInventoryItemException,
  InvalidInventoryPhotoException,
  InventoryAlreadySupersededException,
  InventoryConfirmedException,
  InventoryEmptyException,
  InventoryNotConfirmedException,
  InventoryReturnNotAllowedException,
  TooManyInventoryPhotosException,
} from './inventory.exceptions'
import { STANDARD_INVENTORY_TEMPLATE } from './inventory-template'

export interface DraftItem {
  category: string
  description: string
  condition: ItemCondition
  notes: string | null
}

export interface PhotoKind {
  extension: 'jpg' | 'png' | 'webp' | 'heic'
  contentType: string
}

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
])

/** Lo mínimo del contrato que decide si se puede cargar una devolución. */
export interface ContractWindow {
  status: string
  endDate: IsoDate
}

/** Reglas de negocio del inventario. Puras: sin NestJS ni Prisma. */
export const InventoryPolicy = {
  normalizeDate(value: string): IsoDate {
    const trimmed = value.trim()
    if (!isValidIsoDate(trimmed)) throw new InvalidInventoryDateException()
    return trimmed
  },

  /** Texto libre: sin espacios de más; vacío es "sin dato". */
  normalizeNotes(value: string | null | undefined): string | null {
    const trimmed = value?.trim().replace(/[ \t]+/g, ' ')
    return trimmed ? trimmed : null
  },

  normalizeItems(items: DraftItem[]): DraftItem[] {
    if (items.length > MAX_ITEMS_PER_INVENTORY) {
      throw new InvalidInventoryItemException(
        `Un inventario admite hasta ${MAX_ITEMS_PER_INVENTORY} ítems`,
      )
    }
    return items.map((item) => {
      const category = item.category.trim().replace(/\s+/g, ' ')
      const description = item.description.trim().replace(/\s+/g, ' ')
      if (!category) {
        throw new InvalidInventoryItemException('Cada ítem necesita categoría')
      }
      if (!description) {
        throw new InvalidInventoryItemException(
          'Cada ítem necesita una descripción',
        )
      }
      return {
        category,
        description,
        condition: item.condition,
        notes: InventoryPolicy.normalizeNotes(item.notes),
      }
    })
  },

  /** La plantilla estándar (A-43), con todo en "No aplica". */
  standardItems(): DraftItem[] {
    return STANDARD_INVENTORY_TEMPLATE.flatMap(({ category, descriptions }) =>
      descriptions.map((description) => ({
        category,
        description,
        condition: ItemCondition.NOT_APPLICABLE,
        notes: null,
      })),
    )
  },

  /**
   * A-44: la devolución se carga con el contrato ya no activo (finalizado o
   * rescindido) o cuando faltan 30 días o menos para su fin.
   */
  canCreateReturn(contract: ContractWindow, today: IsoDate): boolean {
    if (contract.status !== 'ACTIVE') return true
    return daysBetween(today, contract.endDate) <= RETURN_WINDOW_DAYS
  },

  assertCanCreate(
    type: InventoryType,
    contract: ContractWindow,
    today: IsoDate,
  ): void {
    if (
      type === InventoryType.RETURN &&
      !InventoryPolicy.canCreateReturn(contract, today)
    ) {
      throw new InventoryReturnNotAllowedException()
    }
  },

  assertDraft(inventory: Pick<Inventory, 'status'>): void {
    if (inventory.status === InventoryStatus.CONFIRMED) {
      throw new InventoryConfirmedException()
    }
  },

  /** Confirmar exige haber evaluado algo: todo "No aplica" no es un acta. */
  assertCanConfirm(inventory: Pick<Inventory, 'items'>): void {
    const evaluated = inventory.items.some(
      (item) => item.condition !== ItemCondition.NOT_APPLICABLE,
    )
    if (!evaluated) throw new InventoryEmptyException()
  },

  /** Sólo se corrige lo confirmado y vigente. */
  assertCanCorrect(
    inventory: Pick<Inventory, 'status' | 'supersededById'>,
  ): void {
    if (inventory.status !== InventoryStatus.CONFIRMED) {
      throw new InventoryNotConfirmedException()
    }
    if (inventory.supersededById)
      throw new InventoryAlreadySupersededException()
  },

  /** Avisos al confirmar: lo que está mal y no tiene foto que lo respalde. */
  warnings(
    items: Pick<
      InventoryItem,
      'category' | 'description' | 'condition' | 'photos'
    >[],
  ): string[] {
    return items
      .filter(
        (item) =>
          item.condition === ItemCondition.POOR && item.photos.length === 0,
      )
      .map(
        (item) =>
          `${item.category} · ${item.description}: está en mal estado y no tiene fotos`,
      )
  },

  /** Una foto: JPG, PNG, WebP o HEIC reconocidos por sus primeros bytes, hasta 10 MB. */
  photoKind(file: Buffer): PhotoKind {
    if (file.length === 0) {
      throw new InvalidInventoryPhotoException('el archivo está vacío')
    }
    if (file.length > MAX_PHOTO_BYTES) {
      throw new InvalidInventoryPhotoException('tiene que pesar hasta 10 MB')
    }
    const kind = detectFileKind(file)
    if (kind && kind.extension !== 'pdf') {
      return { extension: kind.extension, contentType: kind.contentType }
    }
    if (isHeic(file)) return { extension: 'heic', contentType: 'image/heic' }
    throw new InvalidInventoryPhotoException(
      'tiene que ser una imagen JPG, PNG, WebP o HEIC',
    )
  },

  assertCanAddPhotos(current: number, incoming: number): void {
    if (current + incoming > MAX_PHOTOS_PER_ITEM) {
      throw new TooManyInventoryPhotosException(MAX_PHOTOS_PER_ITEM)
    }
  },
}

function isHeic(file: Buffer): boolean {
  return (
    file.subarray(4, 8).toString('latin1') === 'ftyp' &&
    HEIC_BRANDS.has(file.subarray(8, 12).toString('latin1'))
  )
}
