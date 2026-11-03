import { QueueDefinition } from '@/platform/queue/queue.port'

/** Corrida manual de una zona (`POST /valuation/zones/refresh`), con su AsyncJob. */
export const REFRESH_ZONE_QUEUE: QueueDefinition = {
  name: 'valuation-refresh-zone',
  // Una corrida que falla queda en el AsyncJob con su motivo; no insiste contra un portal.
  retryLimit: 0,
}

export const REFRESH_ZONE_JOB_TYPE = 'valuation-refresh-zone'

export interface RefreshZonePayload {
  jobId: string
  zoneKey: string
}
