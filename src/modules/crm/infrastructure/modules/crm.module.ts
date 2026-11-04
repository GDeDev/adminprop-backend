import { Module } from '@nestjs/common'

import { NotificationsModule } from '@/modules/notifications/public'
import { PropertiesModule } from '@/modules/properties/public'
import { TenantsModule } from '@/modules/tenants/public'
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
import { InquiryNotifier } from '../../application/inquiry-notifier'
import { InquiryRegistrar } from '../../application/inquiry-registrar'
import { InquiryViews } from '../../application/crm.views'
import { PropertyViewsRecorder } from '../../application/property-views-recorder'
import {
  InquiryActivityRepository,
  InquiryRepository,
  ListingChannelRepository,
  PropertyListingRepository,
  PropertyViewRepository,
} from '../../domain/crm.ports'
import { CrmFacade } from '../../public/crm.facade'
import { CrmController } from '../http/controllers/crm.controller'
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
  imports: [PropertiesModule, TenantsModule, NotificationsModule],
  controllers: [CrmController],
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
