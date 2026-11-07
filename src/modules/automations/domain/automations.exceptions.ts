import { DomainErrorKind, DomainException } from '@/shared/errors'

export class JobNotFoundException extends DomainException {
  constructor(job: string) {
    super(
      'AUTOMATION_JOB_NOT_FOUND',
      `No existe el job "${job}"`,
      DomainErrorKind.NotFound,
      { job },
    )
  }
}

export class JobAlreadyRunningException extends DomainException {
  constructor(job: string) {
    super(
      'AUTOMATION_JOB_RUNNING',
      'Ese job ya se está ejecutando: esperá a que termine',
      DomainErrorKind.Conflict,
      { job },
    )
  }
}

/** Un job global sin corrida manual permitida desde una inmobiliaria (D-254). */
export class GlobalJobForbiddenException extends DomainException {
  constructor(job: string) {
    super(
      'AUTOMATION_JOB_GLOBAL',
      'Esa tarea es de toda la plataforma: corre sola en su horario',
      DomainErrorKind.Forbidden,
      { job },
    )
  }
}

/** Un job global que ya se corrió hace poco (D-254). */
export class GlobalJobCooldownException extends DomainException {
  constructor(job: string, minutes: number) {
    super(
      'AUTOMATION_JOB_COOLDOWN',
      `Esa tarea ya corrió hace poco: se puede volver a pedir cada ${minutes} minutos`,
      DomainErrorKind.Conflict,
      { job },
    )
  }
}

export class InvalidJobPeriodException extends DomainException {
  constructor() {
    super(
      'AUTOMATION_INVALID_PERIOD',
      'El período tiene que ser AAAA-MM',
      DomainErrorKind.InvalidInput,
    )
  }
}

export class AlertNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'AUTOMATION_ALERT_NOT_FOUND',
      'No existe el aviso',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}
