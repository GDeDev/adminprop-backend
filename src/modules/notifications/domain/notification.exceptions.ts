import { DomainErrorKind, DomainException } from '@/shared/errors'

export class NotificationNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'NOTIFICATION_NOT_FOUND',
      'No existe la notificación',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class NotificationNotResendableException extends DomainException {
  constructor(id: string) {
    super(
      'NOTIFICATION_NOT_RESENDABLE',
      'Sólo se pueden reenviar las notificaciones que fallaron',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

export class NotificationMandatoryException extends DomainException {
  constructor(type: string) {
    super(
      'NOTIFICATION_MANDATORY',
      'Este aviso es obligatorio: no se puede deshabilitar ni dejar sin sus canales originales',
      DomainErrorKind.BusinessRule,
      { type },
    )
  }
}

export class NotificationChannelNotAvailableException extends DomainException {
  constructor(type: string, channel: string) {
    super(
      'NOTIFICATION_CHANNEL_NOT_AVAILABLE',
      'Ese canal no está disponible para este aviso',
      DomainErrorKind.BusinessRule,
      { type, channel },
    )
  }
}

export class NotificationTypeUnknownException extends DomainException {
  constructor(type: string) {
    super(
      'NOTIFICATION_TYPE_UNKNOWN',
      'El tipo de aviso no existe',
      DomainErrorKind.NotFound,
      { type },
    )
  }
}

export class TemplateNotFoundException extends DomainException {
  constructor(key: string) {
    super(
      'TEMPLATE_NOT_FOUND',
      'No existe la plantilla',
      DomainErrorKind.NotFound,
      { key },
    )
  }
}

export class TemplateUnknownVariableException extends DomainException {
  constructor(variables: string[]) {
    super(
      'TEMPLATE_UNKNOWN_VARIABLE',
      `La plantilla usa variables que no existen para este aviso: ${variables
        .map((name) => `{{${name}}}`)
        .join(', ')}`,
      DomainErrorKind.BusinessRule,
      { variables },
    )
  }
}

export class UserWithoutEmailException extends DomainException {
  constructor() {
    super(
      'TEMPLATE_TEST_NO_EMAIL',
      'Tu usuario no tiene un email para mandarte la prueba',
      DomainErrorKind.BusinessRule,
    )
  }
}

export class DevEventsDisabledException extends DomainException {
  constructor() {
    super(
      'DEV_EVENTS_DISABLED',
      'Los eventos simulados sólo existen en desarrollo con el adapter de consola',
      DomainErrorKind.NotFound,
    )
  }
}
