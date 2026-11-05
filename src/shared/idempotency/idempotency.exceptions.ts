import { DomainErrorKind, DomainException } from '@/shared/errors'

export class InvalidIdempotencyKeyException extends DomainException {
  constructor() {
    super(
      'IDEMPOTENCY_KEY_INVALID',
      'Idempotency-Key tiene que tener entre 1 y 128 caracteres imprimibles, sin espacios',
      DomainErrorKind.InvalidInput,
      { field: 'Idempotency-Key' },
    )
  }
}

/** La misma clave con otro pedido: casi seguro un bug del cliente. */
export class IdempotencyKeyReusedException extends DomainException {
  constructor() {
    super(
      'IDEMPOTENCY_KEY_REUSED',
      'Esa Idempotency-Key ya se usó con otro pedido: generá una clave nueva',
      DomainErrorKind.Conflict,
    )
  }
}

/** La clave existe pero su primera ejecución no terminó: reintentar. */
export class IdempotencyKeyInProgressException extends DomainException {
  constructor() {
    super(
      'IDEMPOTENCY_KEY_IN_PROGRESS',
      'Hay otro pedido con esa Idempotency-Key en curso: reintentá en unos segundos',
      DomainErrorKind.Conflict,
    )
  }
}
