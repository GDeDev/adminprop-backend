import { DomainErrorKind, DomainException } from '@/shared/errors'

export class ValuationPropertyNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'VALUATION_PROPERTY_NOT_FOUND',
      'La propiedad no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class ValuationLocationNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'VALUATION_LOCATION_NOT_FOUND',
      'La ubicación no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class InsufficientMarketDataException extends DomainException {
  constructor(zoneKey: string, found: number, needed: number) {
    super(
      'INSUFFICIENT_MARKET_DATA',
      'No hay suficientes datos de mercado para esta zona todavía',
      DomainErrorKind.BusinessRule,
      { zoneKey, found, needed },
    )
  }
}

/** La ubicación de la propiedad no permite armar una zona de mercado. */
export class ValuationNoZoneException extends DomainException {
  constructor(propertyId: string) {
    super(
      'VALUATION_NO_ZONE',
      'No se pudo determinar la zona de mercado de la propiedad',
      DomainErrorKind.BusinessRule,
      { propertyId },
    )
  }
}
