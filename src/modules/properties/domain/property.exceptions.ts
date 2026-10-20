import { DomainErrorKind, DomainException } from '@/shared/errors'

import { MAX_PHOTOS_PER_PROPERTY, PropertyStatus } from './property'

const STATUS_LABELS: Record<PropertyStatus, string> = {
  [PropertyStatus.AVAILABLE]: 'disponible',
  [PropertyStatus.RENTED]: 'alquilada',
  [PropertyStatus.MAINTENANCE]: 'en mantenimiento',
}

export class PropertyNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'PROPERTY_NOT_FOUND',
      'La propiedad no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class PropertyPhotoNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'PROPERTY_PHOTO_NOT_FOUND',
      'La foto no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class InvalidStatusTransitionException extends DomainException {
  constructor(from: PropertyStatus, to: PropertyStatus) {
    super(
      'PROPERTY_INVALID_STATUS_TRANSITION',
      `Una propiedad ${STATUS_LABELS[from]} no puede pasar a ${STATUS_LABELS[to]}`,
      DomainErrorKind.BusinessRule,
    )
  }
}

/** Spec 4: el contrato activo manda sobre el estado; se cambia desde el contrato. */
export class PropertyHasActiveContractException extends DomainException {
  constructor() {
    super(
      'PROPERTY_HAS_ACTIVE_CONTRACT',
      'La propiedad tiene un contrato activo: el estado cambia al finalizar o rescindir el contrato',
      DomainErrorKind.Conflict,
    )
  }
}

export class PropertyHasContractHistoryException extends DomainException {
  constructor() {
    super(
      'PROPERTY_HAS_CONTRACT_HISTORY',
      'No se puede eliminar: la propiedad tiene historial de contratos. Pasala a mantenimiento en su lugar.',
      DomainErrorKind.Conflict,
    )
  }
}

/** Spec 6: la foto 21 es un 400. */
export class TooManyPhotosException extends DomainException {
  constructor(current: number, incoming: number) {
    super(
      'PROPERTY_TOO_MANY_PHOTOS',
      `Una propiedad puede tener hasta ${MAX_PHOTOS_PER_PROPERTY} fotos. Ya tiene ${current} y se intentó agregar ${incoming}.`,
      DomainErrorKind.InvalidInput,
      { current, incoming },
    )
  }
}

/**
 * Un maestro elegido no existe (o es de otra inmobiliaria) o está
 * desactivado: en una alta o un cambio sólo se eligen activos (Fase 5, 4).
 */
export class InvalidMasterDataReferenceException extends DomainException {
  constructor(field: string, message: string) {
    super(
      'PROPERTY_INVALID_MASTER_DATA',
      message,
      DomainErrorKind.BusinessRule,
      { field },
    )
  }
}

/** El propietario elegido no existe, es de otra inmobiliaria o fue borrado. */
export class InvalidOwnerReferenceException extends DomainException {
  constructor() {
    super(
      'PROPERTY_INVALID_OWNER',
      'El propietario no existe',
      DomainErrorKind.BusinessRule,
      { field: 'ownerId' },
    )
  }
}
