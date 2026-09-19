import { DomainErrorKind, DomainException } from '@/shared/errors'

/**
 * Una clase por regla que falla, con un `code` estable para el front y un
 * mensaje para mostrar. Así se ven las excepciones de dominio en todo el
 * proyecto.
 */

export class ExampleItemNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'EXAMPLE_ITEM_NOT_FOUND',
      'El ítem no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class ExampleItemNameTakenException extends DomainException {
  constructor(name: string) {
    super(
      'EXAMPLE_ITEM_NAME_TAKEN',
      `Ya existe un ítem llamado "${name}"`,
      DomainErrorKind.Conflict,
    )
  }
}

export class ExampleItemInvalidPriceException extends DomainException {
  constructor() {
    super(
      'EXAMPLE_ITEM_INVALID_PRICE',
      'El precio tiene que ser mayor a cero',
      DomainErrorKind.BusinessRule,
    )
  }
}

export class InvalidPriceIncreaseException extends DomainException {
  constructor() {
    super(
      'EXAMPLE_INVALID_PRICE_INCREASE',
      'El aumento tiene que ser mayor a 0% y como máximo 100%',
      DomainErrorKind.BusinessRule,
    )
  }
}
