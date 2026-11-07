import { DomainErrorKind, DomainException } from '@/shared/errors'

/** El rango de fechas del reporte no se puede interpretar o es demasiado largo. */
export class InvalidReportRangeException extends DomainException {
  constructor(message: string) {
    super('INVALID_REPORT_RANGE', message, DomainErrorKind.InvalidInput)
  }
}
