import { Module } from '@nestjs/common'

import {
  DeleteTenantLogoHandler,
  UpdateTenantSettingsHandler,
  UploadTenantLogoHandler,
} from '@/modules/tenants/application/commands/tenant-settings.handlers'
import { GetCurrentTenantHandler } from '@/modules/tenants/application/queries/get-current-tenant/get-current-tenant.handler'
import { GetTenantBrandingHandler } from '@/modules/tenants/application/queries/get-tenant-branding/get-tenant-branding.handler'
import { GetTenantSettingsHandler } from '@/modules/tenants/application/queries/get-tenant-settings/get-tenant-settings.handler'
import { TenantRepository } from '@/modules/tenants/domain/tenant.repository'
import { TenantsFacade } from '@/modules/tenants/public/tenants.facade'
import { TenantsController } from '../http/controllers/tenants.controller'
import { TenantRepositoryImpl } from '../repositories/tenant.repository.impl'

/**
 * Inmobiliarias (tenants). El alta es por comando (`npm run tenant:create`);
 * el admin edita su configuración (datos legales, marca, logo) desde la Fase 15.
 */
@Module({
  controllers: [TenantsController],
  providers: [
    { provide: TenantRepository, useClass: TenantRepositoryImpl },
    GetCurrentTenantHandler,
    GetTenantBrandingHandler,
    GetTenantSettingsHandler,
    UpdateTenantSettingsHandler,
    UploadTenantLogoHandler,
    DeleteTenantLogoHandler,
    TenantsFacade,
  ],
  exports: [TenantsFacade],
})
export class TenantsModule {}
