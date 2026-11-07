import { DomainErrorKind, DomainException } from '@/shared/errors'

/** El usuario de portal no está vinculado a ninguna ficha (se borró o nunca se vinculó). */
export class PortalProfileNotFoundException extends DomainException {
  constructor(role: 'OWNER' | 'RENTER') {
    super(
      'PORTAL_PROFILE_NOT_FOUND',
      role === 'OWNER'
        ? 'Tu usuario no está asociado a ningún propietario'
        : 'Tu usuario no está asociado a ningún inquilino',
      DomainErrorKind.NotFound,
    )
  }
}

/**
 * Lo pedido no existe o es de otra persona. Es siempre 404, nunca 403: el
 * portal no revela que el dato existe (Fase 17/18, 1).
 */
export class PortalEntityNotFoundException extends DomainException {
  constructor(code: string, message: string, id: string) {
    super(code, message, DomainErrorKind.NotFound, { id })
  }
}

/** El PDF todavía no se generó (o la generación falló): volver a intentar en un momento. */
export class PortalDocumentNotReadyException extends DomainException {
  constructor(id: string) {
    super(
      'DOCUMENT_NOT_READY',
      'El documento todavía no está listo, probá de nuevo en un momento',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}
