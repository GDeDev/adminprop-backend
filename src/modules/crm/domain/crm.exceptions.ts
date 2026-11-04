import { DomainErrorKind, DomainException } from '@/shared/errors'

export class InquiryNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'INQUIRY_NOT_FOUND',
      'La consulta no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** Asignar a un usuario inactivo, borrado o de otra inmobiliaria. */
export class AssigneeInvalidException extends DomainException {
  constructor(userId: string) {
    super(
      'ASSIGNEE_INVALID',
      'No se puede asignar a ese usuario',
      DomainErrorKind.BusinessRule,
      { userId },
    )
  }
}

export class LostReasonRequiredException extends DomainException {
  constructor() {
    super(
      'LOST_REASON_REQUIRED',
      'Indicá el motivo por el que se perdió la consulta',
      DomainErrorKind.BusinessRule,
    )
  }
}

export class InquiryContactRequiredException extends DomainException {
  constructor() {
    super(
      'INQUIRY_CONTACT_REQUIRED',
      'Cargá al menos un email o un teléfono',
      DomainErrorKind.BusinessRule,
    )
  }
}

export class InquiryPropertyNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'PROPERTY_NOT_FOUND',
      'La propiedad no existe',
      DomainErrorKind.BusinessRule,
      { id },
    )
  }
}

/** `beforeId`/`afterId` que no son de la columna de destino. */
export class InvalidBoardNeighbourException extends DomainException {
  constructor() {
    super(
      'INVALID_BOARD_NEIGHBOUR',
      'La posición pedida no corresponde a esa columna',
      DomainErrorKind.BusinessRule,
    )
  }
}

export class AnalyticsRangeInvalidException extends DomainException {
  constructor() {
    super(
      'ANALYTICS_RANGE_INVALID',
      'El rango de fechas no es válido (máximo 366 días)',
      DomainErrorKind.BusinessRule,
    )
  }
}

// ----------------------------------------------------------- Multipublicación

export class ChannelNotConnectedException extends DomainException {
  constructor(channel: string) {
    super(
      'CHANNEL_NOT_CONNECTED',
      'Conectá la cuenta del portal antes de publicar',
      DomainErrorKind.Conflict,
      { channel },
    )
  }
}

export class ChannelUnavailableForTenantException extends DomainException {
  constructor(channel: string) {
    super(
      'CHANNEL_UNAVAILABLE',
      'Este portal todavía no está disponible',
      DomainErrorKind.BusinessRule,
      { channel },
    )
  }
}

export class ListingNotFoundException extends DomainException {
  constructor(propertyId: string, channel: string) {
    super(
      'LISTING_NOT_FOUND',
      'La propiedad no está publicada en ese portal',
      DomainErrorKind.NotFound,
      { propertyId, channel },
    )
  }
}

export class ListingStateInvalidException extends DomainException {
  constructor(action: string, status: string) {
    super(
      'LISTING_STATE_INVALID',
      'La publicación no admite esa acción en su estado actual',
      DomainErrorKind.Conflict,
      { action, status },
    )
  }
}

export class OAuthStateInvalidException extends DomainException {
  constructor() {
    super(
      'OAUTH_STATE_INVALID',
      'La autorización venció o no es válida. Volvé a conectar la cuenta',
      DomainErrorKind.InvalidInput,
    )
  }
}

/** La propiedad pedida (analítica, publicación) no existe en esta inmobiliaria. */
export class CrmPropertyNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'PROPERTY_NOT_FOUND',
      'La propiedad no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class WhatsAppTemplateNotFoundException extends DomainException {
  constructor(key: string) {
    super(
      'TEMPLATE_NOT_FOUND',
      'La plantilla de WhatsApp no existe',
      DomainErrorKind.NotFound,
      { key },
    )
  }
}
