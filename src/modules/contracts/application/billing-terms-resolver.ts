import { Injectable } from '@nestjs/common'

import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { IsoDate } from '@/shared/dates/calendar-date'
import {
  billingTermsInForce,
  Contract,
  LateFeeDefaults,
  ResolvedBillingTerms,
} from '../domain/contract'
import { ContractPolicy } from '../domain/contract.policy'

/**
 * Resuelve los términos de cobro vigentes de un contrato a una fecha,
 * completando el punitorio con el de la inmobiliaria donde el contrato no
 * lo fijó (D-70). Vive en la capa de aplicación porque toca la facade de
 * inmobiliarias, que un `public/` no puede importar; `ContractsFacade` y las
 * vistas delegan acá.
 */
@Injectable()
export class BillingTermsResolver {
  constructor(private readonly tenants: TenantsFacade) {}

  /** Los defaults del tenant del contexto. Se leen en cada consulta, sin caché. */
  async defaults(): Promise<LateFeeDefaults> {
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Consulta de contratos fuera de un tenant')
    const settings = await this.tenants.getBillingSettings(tenantId)
    return {
      dailyLateFeePercentage: settings.dailyLateFeePercentage,
      paymentGraceDays: settings.paymentGraceDays,
    }
  }

  /** Los términos vigentes a `date`, resueltos. */
  async inForce(
    contract: Contract,
    date: IsoDate,
  ): Promise<ResolvedBillingTerms> {
    return this.resolve(contract, date, await this.defaults())
  }

  resolve(
    contract: Contract,
    date: IsoDate,
    defaults: LateFeeDefaults,
  ): ResolvedBillingTerms {
    return ContractPolicy.resolveBillingTerms(
      billingTermsInForce(contract.billingTerms, date),
      defaults,
    )
  }
}
