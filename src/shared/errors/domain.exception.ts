/**
 * Qué tipo de falla de negocio es. El filtro global lo traduce a un status
 * HTTP; el dominio nunca elige un status, porque no sabe que existe HTTP.
 */
export enum DomainErrorKind {
  /** El dato pedido no existe (o es de otro tenant). → 404 */
  NotFound = 'not_found',
  /** Choca con el estado actual: duplicado, ya activo, ya cerrado. → 409 */
  Conflict = 'conflict',
  /** El pedido está bien formado pero viola una regla de negocio. → 422 */
  BusinessRule = 'business_rule',
  /** El usuario está autenticado pero la regla no le permite hacerlo. → 403 */
  Forbidden = 'forbidden',
}

/**
 * Base de las excepciones de dominio (spec Fase 1, sección 8).
 *
 * Cada regla de negocio que falla tiene su clase, con un `code` estable que el
 * frontend usa para ramificar y un mensaje en español para mostrar:
 *
 * ```ts
 * export class ContractAlreadyActiveException extends DomainException {
 *   constructor(contractId: string) {
 *     super(
 *       'CONTRACT_ALREADY_ACTIVE',
 *       'El contrato ya está activo',
 *       DomainErrorKind.Conflict,
 *       { contractId },
 *     )
 *   }
 * }
 * ```
 *
 * Extiende `Error` y no `HttpException` a propósito: el dominio no importa
 * NestJS. Para errores de infraestructura o de entrada (token vencido, body
 * inválido) sigue estando `AppException`.
 */
export abstract class DomainException extends Error {
  protected constructor(
    /** Código estable, en SCREAMING_SNAKE_CASE. El contrato con el front. */
    readonly code: string,
    message: string,
    readonly kind: DomainErrorKind,
    /** Contexto para los logs. Nunca se serializa al cliente. */
    readonly metadata?: Record<string, unknown>,
  ) {
    super(message)
    this.name = new.target.name
  }
}
