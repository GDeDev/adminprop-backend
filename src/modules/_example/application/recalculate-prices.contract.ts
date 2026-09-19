import { QueueDefinition } from '@/platform/queue/queue.port'

/** Flag que habilita el aumento masivo. En Flagsmith se prende por tenant. */
export const EXAMPLE_BULK_RECALCULATE_FLAG = 'example-bulk-recalculate'

/**
 * Cola interna de `_example`: la publica el handler y la consume el worker
 * del mismo módulo, por eso no está en `public/`.
 */
export const RECALCULATE_PRICES_QUEUE: QueueDefinition = {
  name: 'example-recalculate-prices',
  retryLimit: 2,
  // Corto a propósito para que el reintento simulado se vea rápido.
  retryDelaySeconds: 2,
  retryBackoff: false,
}

export interface RecalculatePricesJobPayload {
  jobId: string
  percentage: string
  simulateTransientFailure: boolean
}
