import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { TenantNotFoundException } from '@/modules/tenants/domain/tenant.exceptions'
import { TenantRepository } from '@/modules/tenants/domain/tenant.repository'
import {
  TenantSettingsView,
  toTenantSettingsView,
} from '../../tenant-settings.view'
import { GetTenantSettingsQuery } from './get-tenant-settings.query'

/** La configuración completa de la inmobiliaria del usuario (Fase 15, 7). */
@QueryHandler(GetTenantSettingsQuery)
export class GetTenantSettingsHandler implements IQueryHandler<
  GetTenantSettingsQuery,
  TenantSettingsView
> {
  constructor(private readonly tenants: TenantRepository) {}

  async execute(query: GetTenantSettingsQuery): Promise<TenantSettingsView> {
    const tenant = await this.tenants.findById(query.tenantId)
    if (!tenant) throw new TenantNotFoundException()
    return toTenantSettingsView(tenant)
  }
}
