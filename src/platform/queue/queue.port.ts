/**
 * Cola de trabajos (spec Fase 1, sección 5.2).
 *
 * Hoy la implementa pg-boss sobre el mismo Postgres; mañana, SQS. Quien
 * publica o consume sólo conoce este puerto, nunca el SDK del proveedor.
 *
 * Es una clase abstracta y no una interface para poder usarla como token de
 * inyección de NestJS.
 */
export abstract class QueuePort {
  /**
   * Declara una cola y su dead-letter. Idempotente: publicar y consumir la
   * llaman los dos, así ninguno depende de que el otro haya arrancado antes.
   */
  abstract declare(definition: QueueDefinition): Promise<void>

  /**
   * Encola un mensaje. El tenant, el usuario y el correlationId del contexto
   * actual viajan con él y se restauran al consumirlo.
   *
   * @returns el id del trabajo en la cola.
   */
  abstract publish<T extends object>(
    definition: QueueDefinition,
    payload: T,
    options?: PublishOptions,
  ): Promise<string>

  /**
   * Registra el consumidor de una cola. El handler corre dentro del tenant del
   * mensaje (`RequestContext.runInTenant`), así que los repositorios filtran
   * igual que en un request HTTP.
   *
   * Si el handler tira, el mensaje se reintenta según `retryLimit`; agotados
   * los reintentos, pasa a la dead-letter de la cola.
   */
  abstract consume<T extends object>(
    definition: QueueDefinition,
    handler: QueueHandler<T>,
  ): Promise<void>
}

export interface QueueDefinition {
  /** Nombre de la cola: letras, números, guiones y guiones bajos. */
  name: string
  /** Reintentos después del primer intento. Default: 3. */
  retryLimit?: number
  /** Segundos entre reintentos. Default: 30. */
  retryDelaySeconds?: number
  /** Duplica la espera en cada reintento. Default: true. */
  retryBackoff?: boolean
}

export interface PublishOptions {
  /**
   * Evita encolar dos veces el mismo trabajo mientras el primero siga
   * pendiente (ej. `"regenerate-pdfs:2026-09"`).
   */
  singletonKey?: string
  /** Demora el primer intento. */
  startAfterSeconds?: number
}

export interface QueueMessage<T> {
  id: string
  payload: T
  /** Tenant en el que se publicó. Ausente sólo en trabajos de sistema. */
  tenantId?: string
  correlationId?: string
  /** Reintento en curso: 0 en el primer intento. */
  retryCount: number
}

export type QueueHandler<T> = (message: QueueMessage<T>) => Promise<void>

export const QUEUE_DEFAULTS = {
  retryLimit: 3,
  retryDelaySeconds: 30,
  retryBackoff: true,
} as const

/** Nombre de la dead-letter de una cola. */
export function deadLetterOf(queueName: string): string {
  return `${queueName}__dead_letter`
}
