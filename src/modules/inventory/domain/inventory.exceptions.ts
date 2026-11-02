import { DomainErrorKind, DomainException } from '@/shared/errors'
import { RETURN_WINDOW_DAYS } from './inventory'

export class InventoryNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'INVENTORY_NOT_FOUND',
      'El inventario no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class InventoryContractNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'INVENTORY_CONTRACT_NOT_FOUND',
      'El contrato no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class InventoryItemNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'INVENTORY_ITEM_NOT_FOUND',
      'El ítem no existe en este inventario',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class InventoryPhotoNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'INVENTORY_PHOTO_NOT_FOUND',
      'La foto no existe en este inventario',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** Confirmado es un acta cerrada: no se edita, no se le suben ni sacan fotos. */
export class InventoryConfirmedException extends DomainException {
  constructor() {
    super(
      'INVENTORY_CONFIRMED',
      'El inventario ya está confirmado y no se puede modificar. Si hay un error, creá una corrección.',
      DomainErrorKind.Conflict,
    )
  }
}

export class InventoryAlreadyExistsException extends DomainException {
  constructor(type: string) {
    super(
      'INVENTORY_ALREADY_EXISTS',
      type === 'DELIVERY'
        ? 'El contrato ya tiene un inventario de entrega. Para cambiarlo, corregilo.'
        : 'El contrato ya tiene un inventario de devolución. Para cambiarlo, corregilo.',
      DomainErrorKind.Conflict,
      { type },
    )
  }
}

export class InventoryNotConfirmedException extends DomainException {
  constructor() {
    super(
      'INVENTORY_NOT_CONFIRMED',
      'Sólo se corrige un inventario confirmado. Uno en borrador se edita directamente.',
      DomainErrorKind.Conflict,
    )
  }
}

export class InventoryAlreadySupersededException extends DomainException {
  constructor() {
    super(
      'INVENTORY_SUPERSEDED',
      'Este inventario ya fue reemplazado por una corrección.',
      DomainErrorKind.Conflict,
    )
  }
}

export class InventoryCorrectionPendingException extends DomainException {
  constructor(correctionId: string) {
    super(
      'INVENTORY_CORRECTION_PENDING',
      'Ya hay una corrección en borrador de este inventario. Terminala y confirmala.',
      DomainErrorKind.Conflict,
      { correctionId },
    )
  }
}

export class InventoryReturnNotAllowedException extends DomainException {
  constructor() {
    super(
      'INVENTORY_RETURN_NOT_ALLOWED',
      `El inventario de devolución se carga cuando el contrato ya no está activo o faltan ${RETURN_WINDOW_DAYS} días o menos para su fin.`,
      DomainErrorKind.BusinessRule,
    )
  }
}

export class InventoryEmptyException extends DomainException {
  constructor() {
    super(
      'INVENTORY_EMPTY',
      'Para confirmar, evaluá al menos un ítem (que no sea "No aplica").',
      DomainErrorKind.BusinessRule,
    )
  }
}

export class InvalidInventoryDateException extends DomainException {
  constructor() {
    super(
      'INVENTORY_INVALID_DATE',
      'La fecha tiene que ser AAAA-MM-DD',
      DomainErrorKind.InvalidInput,
      { field: 'date' },
    )
  }
}

export class InvalidInventoryItemException extends DomainException {
  constructor(reason: string) {
    super('INVENTORY_INVALID_ITEM', reason, DomainErrorKind.InvalidInput, {
      field: 'items',
    })
  }
}

export class InvalidInventoryPhotoException extends DomainException {
  constructor(reason: string) {
    super(
      'INVENTORY_INVALID_PHOTO',
      `La foto no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'files' },
    )
  }
}

export class TooManyInventoryPhotosException extends DomainException {
  constructor(max: number) {
    super(
      'INVENTORY_TOO_MANY_PHOTOS',
      `Un ítem puede tener hasta ${max} fotos`,
      DomainErrorKind.InvalidInput,
      { max },
    )
  }
}
