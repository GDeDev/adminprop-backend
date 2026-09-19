import { DomainErrorKind, DomainException } from '@/shared/errors'

import { Catalog, CATALOG_LABELS } from './catalog'

export class CatalogItemNotFoundException extends DomainException {
  constructor(catalog: Catalog, id: string) {
    super(
      'MASTER_DATA_NOT_FOUND',
      `El ${CATALOG_LABELS[catalog]} no existe`,
      DomainErrorKind.NotFound,
      { catalog, id },
    )
  }
}

/** Spec, casos borde: nombre repetido en el mismo nivel → 409. */
export class CatalogItemNameTakenException extends DomainException {
  constructor(catalog: Catalog, name: string) {
    super(
      'MASTER_DATA_NAME_TAKEN',
      `Ya existe un ${CATALOG_LABELS[catalog]} llamado "${name}"`,
      DomainErrorKind.Conflict,
    )
  }
}

export class LocationNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'LOCATION_NOT_FOUND',
      'La ubicación no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class LocationNameTakenException extends DomainException {
  constructor(name: string) {
    super(
      'LOCATION_NAME_TAKEN',
      `Ya existe "${name}" en ese mismo lugar`,
      DomainErrorKind.Conflict,
    )
  }
}

/**
 * El padre elegido no puede contener a esta ubicación: no existe, es del
 * mismo nivel o de uno más específico (un barrio no contiene una provincia),
 * o se pidió un padre para un país.
 */
export class InvalidLocationParentException extends DomainException {
  constructor(reason: string) {
    super('LOCATION_INVALID_PARENT', reason, DomainErrorKind.BusinessRule)
  }
}
