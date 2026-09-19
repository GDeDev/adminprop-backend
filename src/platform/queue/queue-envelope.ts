import { RequestContext } from '@/shared/context/request-context'
import { QueueHandler, QueueMessage } from './queue.port'

/**
 * Lo que realmente viaja por la cola: el payload más el contexto en el que se
 * publicó. Lo comparten todos los adapters, así el comportamiento de tenant es
 * el mismo con pg-boss, en memoria o, mañana, con SQS.
 */
export interface QueueEnvelope<T> {
  payload: T
  meta: {
    tenantId?: string
    userId?: string
    correlationId?: string
  }
}

export function wrap<T>(payload: T): QueueEnvelope<T> {
  const context = RequestContext.get()
  return {
    payload,
    meta: {
      tenantId: context?.tenantId,
      userId: context?.userId,
      correlationId: context?.correlationId,
    },
  }
}

/**
 * Corre el handler con el contexto del mensaje restaurado: el correlationId
 * para los logs, el usuario para la auditoría y el tenant para el filtro de
 * Prisma. Sin tenant (trabajo de sistema), las consultas a modelos con tenant
 * fallan, como en cualquier otro lugar.
 */
export async function dispatch<T>(
  id: string,
  envelope: QueueEnvelope<T>,
  retryCount: number,
  handler: QueueHandler<T>,
): Promise<void> {
  const message: QueueMessage<T> = {
    id,
    payload: envelope.payload,
    tenantId: envelope.meta.tenantId,
    correlationId: envelope.meta.correlationId,
    retryCount,
  }

  const correlationId = envelope.meta.correlationId ?? `job-${id}`

  await RequestContext.run(
    { correlationId, userId: envelope.meta.userId },
    async () => {
      if (envelope.meta.tenantId) {
        await RequestContext.runInTenant(envelope.meta.tenantId, () =>
          handler(message),
        )
      } else {
        await handler(message)
      }
    },
  )
}
