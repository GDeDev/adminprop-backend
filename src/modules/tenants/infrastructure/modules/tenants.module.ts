import { Module } from '@nestjs/common'

import { GetCurrentTenantHandler } from '@/modules/tenants/application/queries/get-current-tenant/get-current-tenant.handler'
import { GetTenantBrandingHandler } from '@/modules/tenants/application/queries/get-tenant-branding/get-tenant-branding.handler'
import { TenantRepository } from '@/modules/tenants/domain/tenant.repository'
import { TenantsFacade } from '@/modules/tenants/public/tenants.facade'
import { TenantsController } from '../http/controllers/tenants.controller'
import { TenantRepositoryImpl } from '../repositories/tenant.repository.impl'

/**
 * Inmobiliarias (tenants). Por ahora sólo lectura: el alta es por comando
 * (`npm run tenant:create`) y no hay ABM en el MVP.
 */
@Module({
  controllers: [TenantsController],
  providers: [
    { provide: TenantRepository, useClass: TenantRepositoryImpl },
    GetCurrentTenantHandler,
    GetTenantBrandingHandler,
    TenantsFacade,
  ],
  exports: [TenantsFacade],
})
export class TenantsModule {}
