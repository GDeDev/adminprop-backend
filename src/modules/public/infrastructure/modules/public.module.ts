import { Module } from '@nestjs/common'

import { CrmModule } from '@/modules/crm/public'
import { PropertiesModule } from '@/modules/properties/public'
import { TenantsModule } from '@/modules/tenants/public'
import { PublicTenantScope } from '../../application/public-tenant-scope'
import {
  NotifyStaffOnInquiryHandler,
  SubmitPublicInquiryHandler,
} from '../../application/public.handlers'
import {
  GetPublicFiltersHandler,
  GetPublicPropertyHandler,
  ListPublicPropertiesHandler,
} from '../../application/public.queries'
import { PublicController } from '../http/controllers/public.controller'

/**
 * Portal público (spec Fase 22): listado de propiedades disponibles y
 * formulario de consulta, sin JWT y por slug de inmobiliaria, más las
 * consultas que se registran en el CRM (Fase 23). Habla con propiedades,
 * tenants y CRM por sus públicos; las notificaciones y el email son puertos
 * globales. Nadie depende de este módulo.
 */
@Module({
  imports: [PropertiesModule, TenantsModule, CrmModule],
  controllers: [PublicController],
  providers: [
    PublicTenantScope,
    SubmitPublicInquiryHandler,
    NotifyStaffOnInquiryHandler,
    ListPublicPropertiesHandler,
    GetPublicPropertyHandler,
    GetPublicFiltersHandler,
  ],
})
export class PublicModule {}
