import { QueueDefinition } from '@/platform/queue/queue.port'
import { ListingChannel } from '../domain/listing'

/** Publicar o actualizar una propiedad en un portal, con su AsyncJob. */
export const LISTING_PUBLISH_QUEUE: QueueDefinition = {
  name: 'crm-listing-publish',
  // Un fallo queda en la publicación (ERROR) y se reintenta a mano: no insiste contra el portal.
  retryLimit: 0,
}

export const LISTING_PUBLISH_JOB_TYPE = 'listing-publish'

export interface ListingPublishPayload {
  jobId: string
  propertyId: string
  channel: ListingChannel
}

/** Cerrar las publicaciones activas de una propiedad que se alquiló (A-87). */
export const LISTING_CLOSE_QUEUE: QueueDefinition = {
  name: 'crm-listing-close',
  retryLimit: 2,
}

export interface ListingClosePayload {
  propertyId: string
}
