import { Injectable, OnModuleInit } from '@nestjs/common'

import { QueuePort } from '@/platform/queue/queue.port'
import { createLogger } from '@/shared/logging/root-logger'
import {
  LISTING_CLOSE_QUEUE,
  LISTING_PUBLISH_QUEUE,
  ListingClosePayload,
  ListingPublishPayload,
} from '../../application/listing-queues'
import { ListingService } from '../../application/listing.service'

/**
 * Atiende las colas de multipublicación, dentro del tenant del mensaje: la
 * publicación pedida desde la ficha y el cierre automático de las
 * publicaciones de una propiedad que se alquiló.
 */
@Injectable()
export class ListingConsumer implements OnModuleInit {
  private readonly logger = createLogger('ListingConsumer')

  constructor(
    private readonly queue: QueuePort,
    private readonly listings: ListingService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.consume<ListingPublishPayload>(
      LISTING_PUBLISH_QUEUE,
      async (message) => {
        // `runPublish` deja el resultado (o el error) en la publicación y en el AsyncJob.
        await this.listings.runPublish(message.payload)
      },
    )
    await this.queue.consume<ListingClosePayload>(
      LISTING_CLOSE_QUEUE,
      async (message) => {
        const closed = await this.listings.closeAllFor(message.payload)
        this.logger.info(
          { propertyId: message.payload.propertyId, closed },
          'Publicaciones cerradas porque la propiedad se alquiló',
        )
      },
    )
  }
}
