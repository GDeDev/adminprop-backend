import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { TenantNotFoundException } from '@/modules/tenants/domain/tenant.exceptions'
import { TenantRepository } from '@/modules/tenants/domain/tenant.repository'
import {
  TenantBrandingView,
  toTenantBrandingView,
} from '../../tenant-branding.view'
import { GetTenantBrandingQuery } from './get-tenant-branding.query'

/**
 * Marca de una inmobiliaria por su slug, sin sesión: la usa el portal para
 * pintar la pantalla de login antes de que nadie se identifique.
 *
 * Una inmobiliaria deshabilitada responde 404, igual que una inexistente.
 */
@QueryHandler(GetTenantBrandingQuery)
export class GetTenantBrandingHandler implements IQueryHandler<
  GetTenantBrandingQuery,
  TenantBrandingView
> {
  constructor(private readonly tenants: TenantRepository) {}

  async execute(query: GetTenantBrandingQuery): Promise<TenantBrandingView> {
    const tenant = await this.tenants.findBySlug(query.slug)
    if (!tenant?.isActive) throw new TenantNotFoundException()
    return toTenantBrandingView(tenant)
  }
}
