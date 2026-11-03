import { Module } from '@nestjs/common'

import { PropertiesModule } from '@/modules/properties/public'
import { TenantsModule } from '@/modules/tenants/public'
import { PublicTenantScope } from '../../application/public-tenant-scope'
import {
  NotifyStaffOnInquiryHandler,
  SubmitPublicInquiryHandler,
  UpdatePublicInquiryStatusHandler,
} from '../../application/public.handlers'
import {
  GetPublicFiltersHandler,
  GetPublicPropertyHandler,
  ListPublicInquiriesHandler,
  ListPublicPropertiesHandler,
} from '../../application/public.queries'
import { PublicInquiryViews } from '../../application/public.views'
import { PublicInquiryRepository } from '../../domain/public.ports'
import { InquiriesController } from '../http/controllers/inquiries.controller'
import { PublicController } from '../http/controllers/public.controller'
import { PublicInquiryRepositoryImpl } from '../repositories/public-inquiry.repository.impl'

/**
 * Portal público (spec Fase 22): listado de propiedades disponibles y
 * formulario de consulta, sin JWT y por slug de inmobiliaria, más las
 * consultas recibidas para el personal. Habla con propiedades y tenants por
 * sus públicos; las notificaciones y el email son puertos globales. Nadie
 * depende de este módulo.
 */
@Module({
  imports: [PropertiesModule, TenantsModule],
  controllers: [PublicController, InquiriesController],
  providers: [
    { provide: PublicInquiryRepository, useClass: PublicInquiryRepositoryImpl },
    PublicTenantScope,
    PublicInquiryViews,
    SubmitPublicInquiryHandler,
    NotifyStaffOnInquiryHandler,
    UpdatePublicInquiryStatusHandler,
    ListPublicPropertiesHandler,
    GetPublicPropertyHandler,
    GetPublicFiltersHandler,
    ListPublicInquiriesHandler,
  ],
})
export class PublicModule {}
