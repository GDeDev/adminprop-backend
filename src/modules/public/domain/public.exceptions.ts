import { DomainErrorKind, DomainException } from '@/shared/errors'

export class PublicTenantNotFoundException extends DomainException {
  constructor() {
    super(
      'TENANT_NOT_FOUND',
      'La inmobiliaria no existe',
      DomainErrorKind.NotFound,
    )
  }
}

/** Ficha pública de una propiedad que no existe o ya no está disponible. */
export class PropertyNotAvailableException extends DomainException {
  constructor() {
    super(
      'PROPERTY_NOT_AVAILABLE',
      'Esta propiedad ya no está disponible',
      DomainErrorKind.NotFound,
    )
  }
}

/** Consulta sobre una propiedad que dejó de estar disponible: 409 para que el front lo distinga. */
export class InquiryPropertyNotAvailableException extends DomainException {
  constructor() {
    super(
      'PROPERTY_NOT_AVAILABLE',
      'Esta propiedad ya no está disponible',
      DomainErrorKind.Conflict,
    )
  }
}

export class PublicInquiryNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'PUBLIC_INQUIRY_NOT_FOUND',
      'La consulta no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}
