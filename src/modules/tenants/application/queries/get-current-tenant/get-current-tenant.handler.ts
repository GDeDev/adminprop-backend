import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { TenantNotFoundException } from '@/modules/tenants/domain/tenant.exceptions'
import { TenantRepository } from '@/modules/tenants/domain/tenant.repository'
import {
  TenantBrandingView,
  toTenantBrandingView,
} from '../../tenant-branding.view'
import { GetCurrentTenantQuery } from './get-current-tenant.query'

/** La inmobiliaria del usuario logueado (la del JWT). */
@QueryHandler(GetCurrentTenantQuery)
export class GetCurrentTenantHandler implements IQueryHandler<
  GetCurrentTenantQuery,
  TenantBrandingView
> {
  constructor(private readonly tenants: TenantRepository) {}

  async execute(query: GetCurrentTenantQuery): Promise<TenantBrandingView> {
    const tenant = await this.tenants.findById(query.tenantId)
    if (!tenant) throw new TenantNotFoundException()
    return toTenantBrandingView(tenant)
  }
}
