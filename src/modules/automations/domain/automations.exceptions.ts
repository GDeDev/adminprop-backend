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
