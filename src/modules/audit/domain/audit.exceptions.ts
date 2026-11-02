import { DomainErrorKind, DomainException } from '@/shared/errors'

/** El movimiento no existe, o es de otra inmobiliaria (404, nunca 403). */
export class AuditEntryNotFoundException extends DomainException {
  constructor() {
    super(
      'AUDIT_ENTRY_NOT_FOUND',
      'No existe ese movimiento de auditoría',
      DomainErrorKind.NotFound,
    )
  }
}
