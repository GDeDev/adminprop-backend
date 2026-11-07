import { ListingChannel } from '../../domain/listing'
import {
  ListingPublisherPort,
  ListingPublisherRegistry,
} from '../../domain/listing-publisher.port'

/**
 * Un adapter por canal. Hoy sólo Mercado Libre tiene (el simulado o el real,
 * según `LISTING_PUBLISHER_PROVIDER`); Zonaprop y Argenprop no se escriben
 * porque requieren un acuerdo comercial (Fase 23, 6.1).
 */
export class ConfiguredListingPublisherRegistry extends ListingPublisherRegistry {
  constructor(
    private readonly adapters: Partial<
      Record<ListingChannel, ListingPublisherPort>
    >,
  ) {
    super()
  }

  forChannel(channel: ListingChannel): ListingPublisherPort | null {
    return this.adapters[channel] ?? null
  }
}
