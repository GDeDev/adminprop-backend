import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'node:crypto'

import { ContractsModule } from '@/modules/contracts/public'
import { JobsModule } from '@/modules/jobs/public'
import { NotificationsModule } from '@/modules/notifications/public'
import { PropertiesModule } from '@/modules/properties/public'
import { TenantsModule } from '@/modules/tenants/public'
import { Configuration } from '@/shared/config/configuration'
import { ListingPublisherProvider } from '@/shared/config/env.validation'
import {
  GetCrmOverviewHandler,
  GetPropertyAnalyticsHandler,
} from '../../application/analytics.handlers'
import {
  AddInquiryNoteHandler,
  AssignInquiryHandler,
  CreateInquiryHandler,
  GetInquiryHandler,
  GetPipelineHandler,
  GetWhatsAppLinkHandler,
  ListAssigneesHandler,
  ListInquiriesHandler,
  MoveInquiryHandler,
  RecordContactAttemptHandler,
  UpdateInquiryHandler,
} from '../../application/inquiry.handlers'
import { FollowUpReminderService } from '../../application/follow-up-reminder.service'
import {
  ChangeListingStatusHandler,
  CloseListingsOnRentedHandler,
  CompleteChannelOAuthHandler,
  ConnectChannelHandler,
  DisconnectChannelHandler,
  ListChannelsHandler,
  ListPropertyListingsHandler,
  PublishListingHandler,
} from '../../application/listing.handlers'
import { ListingService } from '../../application/listing.service'
import { OAuthStateSigner } from '../../application/oauth-state'
import { InquiryNotifier } from '../../application/inquiry-notifier'
import { InquiryRegistrar } from '../../application/inquiry-registrar'
import { InquiryViews } from '../../application/crm.views'
import { PropertyViewsRecorder } from '../../application/property-views-recorder'
import { ListingPublisherRegistry } from '../../domain/listing-publisher.port'
import { ListingChannel } from '../../domain/listing'
import {
  InquiryActivityRepository,
  InquiryRepository,
  ListingChannelRepository,
  PropertyListingRepository,
  PropertyViewRepository,
} from '../../domain/crm.ports'
import { CrmFacade } from '../../public/crm.facade'
import { ListingConsumer } from '../consumers/listing.consumer'
import { CrmController } from '../http/controllers/crm.controller'
import {
  ChannelOAuthController,
  ChannelsController,
  PropertyListingsController,
} from '../http/controllers/listings.controller'
import { FakeListingPublisher } from '../publishers/fake-listing-publisher'
import { ConfiguredListingPublisherRegistry } from '../publishers/listing-publisher.registry'
import { MercadoLibreListingAdapter } from '../publishers/mercadolibre-listing.adapter'
import {
  InquiryActivityRepositoryImpl,
  ListingChannelRepositoryImpl,
  PropertyListingRepositoryImpl,
  PropertyViewRepositoryImpl,
} from '../repositories/crm.repositories.impl'
import { InquiryRepositoryImpl } from '../repositories/inquiry.repository.impl'

/**
 * CRM y multipublicación (spec Fase 23, rediseño). Dueño de las consultas
 * (A-80). Habla con propiedades, tenants y notificaciones por sus públicos;
 * usuarios (`UsersFacade`) viene del módulo de auth, que es global. El portal
 * público depende de este módulo, no al revés.
 */
@Module({
  imports: [
    PropertiesModule,
    TenantsModule,
    NotificationsModule,
    JobsModule,
    ContractsModule,
  ],
  controllers: [
    CrmController,
    ChannelsController,
    ChannelOAuthController,
    PropertyListingsController,
  ],
  providers: [
    { provide: InquiryRepository, useClass: InquiryRepositoryImpl },
    {
      provide: InquiryActivityRepository,
      useClass: InquiryActivityRepositoryImpl,
    },
    { provide: PropertyViewRepository, useClass: PropertyViewRepositoryImpl },
    {
      provide: ListingChannelRepository,
      useClass: ListingChannelRepositoryImpl,
    },
    {
      provide: PropertyListingRepository,
      useClass: PropertyListingRepositoryImpl,
    },
    {
      provide: FakeListingPublisher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Configuration, true>) =>
        new FakeListingPublisher(
          config.get('listings', { infer: true }).mercadolibre.redirectUri,
        ),
    },
    {
      provide: ListingPublisherRegistry,
      inject: [ConfigService, FakeListingPublisher],
      useFactory: (
        config: ConfigService<Configuration, true>,
        fake: FakeListingPublisher,
      ) => {
        const { provider, mercadolibre } = config.get('listings', {
          infer: true,
        })
        return new ConfiguredListingPublisherRegistry({
          [ListingChannel.MERCADOLIBRE]:
            provider === ListingPublisherProvider.MercadoLibre
              ? new MercadoLibreListingAdapter(mercadolibre)
              : fake,
        })
      },
    },
    {
      // La firma del state no reusa el secreto del JWT tal cual: se deriva uno propio.
      provide: OAuthStateSigner,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Configuration, true>) =>
        new OAuthStateSigner(
          createHash('sha256')
            .update(
              `crm-oauth-state|${config.get('jwt', { infer: true }).accessSecret}`,
            )
            .digest('hex'),
        ),
    },
    ListingService,
    ListingConsumer,
    ListChannelsHandler,
    ConnectChannelHandler,
    CompleteChannelOAuthHandler,
    DisconnectChannelHandler,
    ListPropertyListingsHandler,
    PublishListingHandler,
    ChangeListingStatusHandler,
    CloseListingsOnRentedHandler,
    InquiryViews,
    InquiryRegistrar,
    InquiryNotifier,
    PropertyViewsRecorder,
    FollowUpReminderService,
    CreateInquiryHandler,
    UpdateInquiryHandler,
    MoveInquiryHandler,
    AssignInquiryHandler,
    AddInquiryNoteHandler,
    RecordContactAttemptHandler,
    GetPipelineHandler,
    ListInquiriesHandler,
    GetInquiryHandler,
    GetWhatsAppLinkHandler,
    ListAssigneesHandler,
    GetCrmOverviewHandler,
    GetPropertyAnalyticsHandler,
    CrmFacade,
  ],
  exports: [CrmFacade],
})
export class CrmModule {}
