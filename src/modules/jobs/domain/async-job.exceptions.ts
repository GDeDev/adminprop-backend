import { DomainErrorKind, DomainException } from '@/shared/errors'

/** El trabajo no existe o es de otra inmobiliaria: las dos cosas se ven igual. */
export class AsyncJobNotFoundException extends DomainException {
  constructor(jobId: string) {
    super(
      'ASYNC_JOB_NOT_FOUND',
      'El trabajo no existe',
      DomainErrorKind.NotFound,
      { jobId },
    )
  }
}
