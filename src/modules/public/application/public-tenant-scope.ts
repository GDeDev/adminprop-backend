import { Injectable } from '@nestjs/common'

import { PublicTenantRef, TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { PublicTenantNotFoundException } from '../domain/public.exceptions'

/**
 * Los endpoints públicos no traen JWT: la inmobiliaria sale del slug de la
 * ruta. Una inexistente y una deshabilitada dan el mismo 404, y todo lo que
 * corre adentro lo hace con el tenant fijado (las consultas de Prisma lo
 * exigen), así que un slug nunca deja ver datos de otra inmobiliaria.
 */
@Injectable()
export class PublicTenantScope {
  constructor(private readonly tenants: TenantsFacade) {}

  async run<T>(
    slug: string,
    fn: (tenant: PublicTenantRef) => Promise<T>,
  ): Promise<T> {
    const tenant = await this.tenants.findActiveBySlug(slug)
    if (!tenant) throw new PublicTenantNotFoundException()
    return RequestContext.runInTenant(tenant.id, () => fn(tenant))
  }
}
