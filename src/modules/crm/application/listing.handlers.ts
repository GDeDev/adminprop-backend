import {
  CommandHandler,
  EventsHandler,
  ICommandHandler,
  IEventHandler,
  IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs'

import { PropertyRentedEvent } from '@/modules/properties/public'
import {
  ChangeListingStatusCommand,
  CompleteChannelOAuthCommand,
  ConnectChannelCommand,
  DisconnectChannelCommand,
  ListChannelsQuery,
  ListPropertyListingsQuery,
  PublishListingCommand,
} from './crm.messages'
import { ListingService } from './listing.service'
import { ListingChannelView, PropertyListingView } from './listing.views'

@QueryHandler(ListChannelsQuery)
export class ListChannelsHandler implements IQueryHandler<
  ListChannelsQuery,
  ListingChannelView[]
> {
  constructor(private readonly listings: ListingService) {}

  execute(): Promise<ListingChannelView[]> {
    return this.listings.listChannels()
  }
}

@CommandHandler(ConnectChannelCommand)
export class ConnectChannelHandler implements ICommandHandler<
  ConnectChannelCommand,
  { authorizeUrl: string }
> {
  constructor(private readonly listings: ListingService) {}

  async execute({
    channel,
  }: ConnectChannelCommand): Promise<{ authorizeUrl: string }> {
    return this.listings.connect(channel)
  }
}

@CommandHandler(CompleteChannelOAuthCommand)
export class CompleteChannelOAuthHandler implements ICommandHandler<
  CompleteChannelOAuthCommand,
  string
> {
  constructor(private readonly listings: ListingService) {}

  execute({ channel, code, state, error }: CompleteChannelOAuthCommand) {
    return this.listings.completeOAuth(channel, { code, state, error })
  }
}

@CommandHandler(DisconnectChannelCommand)
export class DisconnectChannelHandler implements ICommandHandler<
  DisconnectChannelCommand,
  ListingChannelView[]
> {
  constructor(private readonly listings: ListingService) {}

  execute({
    channel,
  }: DisconnectChannelCommand): Promise<ListingChannelView[]> {
    return this.listings.disconnect(channel)
  }
}

@QueryHandler(ListPropertyListingsQuery)
export class ListPropertyListingsHandler implements IQueryHandler<
  ListPropertyListingsQuery,
  PropertyListingView[]
> {
  constructor(private readonly listings: ListingService) {}

  execute({
    propertyId,
  }: ListPropertyListingsQuery): Promise<PropertyListingView[]> {
    return this.listings.listingsFor(propertyId)
  }
}

@CommandHandler(PublishListingCommand)
export class PublishListingHandler implements ICommandHandler<
  PublishListingCommand,
  { jobId: string }
> {
  constructor(private readonly listings: ListingService) {}

  execute({
    propertyId,
    channel,
    retry,
  }: PublishListingCommand): Promise<{ jobId: string }> {
    return this.listings.enqueuePublish(propertyId, channel, retry)
  }
}

@CommandHandler(ChangeListingStatusCommand)
export class ChangeListingStatusHandler implements ICommandHandler<
  ChangeListingStatusCommand,
  PropertyListingView
> {
  constructor(private readonly listings: ListingService) {}

  execute({
    propertyId,
    channel,
    action,
  }: ChangeListingStatusCommand): Promise<PropertyListingView> {
    return this.listings.changeStatus(propertyId, channel, action)
  }
}

/**
 * Una propiedad que se alquila deja de estar disponible: sus publicaciones
 * activas se cierran (A-87). Sólo encola; el cierre en el portal corre en la
 * cola, así que un portal caído no frena la firma del contrato.
 */
@EventsHandler(PropertyRentedEvent)
export class CloseListingsOnRentedHandler implements IEventHandler<PropertyRentedEvent> {
  constructor(private readonly listings: ListingService) {}

  handle(event: PropertyRentedEvent): Promise<void> {
    return this.listings.scheduleCloseFor(event.propertyId)
  }
}
