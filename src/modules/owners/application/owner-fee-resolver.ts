import { Injectable } from '@nestjs/common'

import { PropertiesFacade } from '@/modules/properties/public/properties.facade'
import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { toMoneyString } from '@/shared/money'
import { Owner } from '../domain/owner'
import { appliesReducedFee } from '../domain/reduced-fee'

/**
 * Resuelve el % de honorarios de un propietario (Fase 12, 2.1): su override
 * si lo tiene, si no la regla por umbral de la inmobiliaria (RN-06/RN-07).
 * Vive en la capa de aplicación porque un `public/` no puede importar otra
 * facade (misma razón que `BillingTermsResolver`, D-70).
 */
@Injectable()
export class OwnerFeeResolver {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly tenants: TenantsFacade,
  ) {}

  /**
   * `extraActive` suma propiedades que todavía no cuentan como activas: el
   * contrato que se está creando (D-57).
   */
  async feePercentageFor(owner: Owner, extraActive = 0): Promise<string> {
    if (owner.feeSettings.feePercentage !== null) {
      return owner.feeSettings.feePercentage
    }
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Honorarios fuera de un tenant')
    const [settings, portfolios] = await Promise.all([
      this.tenants.getContractSettings(tenantId),
      this.properties.portfolios([owner.id]),
    ])
    const active = (portfolios.get(owner.id)?.active ?? 0) + extraActive
    return toMoneyString(
      appliesReducedFee(active, settings.reducedFeeThreshold)
        ? settings.reducedFeePercentage
        : settings.standardFeePercentage,
    )
  }
}
