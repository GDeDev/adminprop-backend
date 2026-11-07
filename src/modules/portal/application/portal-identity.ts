import { Injectable } from '@nestjs/common'

import { OwnersFacade } from '@/modules/owners/public'
import { RentersFacade } from '@/modules/renters/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { PortalProfileNotFoundException } from '../domain/portal.exceptions'
import { toAgency } from './portal.mappers'
import { PortalAgencyView } from './portal.views'

/**
 * Quién está del otro lado del portal: de un usuario logueado a su ficha de
 * inquilino o propietario (D-16), y la inmobiliaria a la que pertenece. Todo
 * lo que el portal devuelve se filtra después por el id que sale de acá, nunca
 * por uno que venga en la URL.
 */
@Injectable()
export class PortalIdentity {
  constructor(
    private readonly renters: RentersFacade,
    private readonly owners: OwnersFacade,
    private readonly tenants: TenantsFacade,
  ) {}

  async renterId(userId: string): Promise<string> {
    const id = await this.renters.idForPortalUser(userId)
    if (!id) throw new PortalProfileNotFoundException('RENTER')
    return id
  }

  async ownerId(userId: string): Promise<string> {
    const id = await this.owners.idForPortalUser(userId)
    if (!id) throw new PortalProfileNotFoundException('OWNER')
    return id
  }

  async agency(): Promise<PortalAgencyView> {
    const tenantId = RequestContext.tenantId
    // El guard de JWT siempre lo completa para un usuario de portal.
    if (!tenantId) throw new Error('Consulta del portal fuera de un tenant')
    return toAgency(await this.tenants.branding(tenantId))
  }
}
