import { Injectable } from '@nestjs/common'

import {
  OwnerPortfolio,
  OwnerPropertySummary,
  PropertiesFacade,
} from '@/modules/properties/public/properties.facade'
import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { BankAccount, fullNameOf, Owner } from '../domain/owner'
import { appliesReducedFee } from '../domain/reduced-fee'

/** Una fila del listado (spec 3.2 y 5.1). */
export interface OwnerSummaryView {
  id: string
  firstName: string
  lastName: string
  fullName: string
  nationalId: string
  phone: string | null
  email: string | null
  /** Todas las que tiene a cargo, en cualquier estado. */
  propertyCount: number
  /** Las que cuentan para el honorario reducido. */
  activePropertyCount: number
  /** Calculado en cada consulta, nunca guardado (spec 4). */
  reducedFee: boolean
  hasPortalAccess: boolean
  createdAt: Date
  updatedAt: Date
}

/** La ficha (spec 3.3). */
export interface OwnerDetailView extends OwnerSummaryView {
  address: string | null
  notes: string | null
  bankAccount: BankAccount
  properties: OwnerPropertySummary[]
}

/**
 * Arma las vistas con los conteos de propiedades de todos los propietarios de
 * la página juntos: un listado de 20 hace una consulta de conteo, no 20.
 */
@Injectable()
export class OwnerViews {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly tenants: TenantsFacade,
  ) {}

  async summaries(owners: Owner[]): Promise<OwnerSummaryView[]> {
    if (owners.length === 0) return []
    const [portfolios, threshold] = await Promise.all([
      this.properties.portfolios(owners.map((o) => o.id)),
      this.threshold(),
    ])
    return owners.map((owner) =>
      toSummary(owner, portfolios.get(owner.id), threshold),
    )
  }

  async detail(owner: Owner): Promise<OwnerDetailView> {
    const [portfolios, threshold, properties] = await Promise.all([
      this.properties.portfolios([owner.id]),
      this.threshold(),
      this.properties.listByOwner(owner.id),
    ])
    return {
      ...toSummary(owner, portfolios.get(owner.id), threshold),
      address: owner.address,
      notes: owner.notes,
      bankAccount: owner.bankAccount,
      properties,
    }
  }

  private threshold(): Promise<number> {
    const tenantId = RequestContext.tenantId
    // El guard siempre lo completa; sin tenant, la consulta de propietarios ya
    // habría fallado antes (la extensión cierra por defecto).
    if (!tenantId)
      throw new Error('Consulta de propietarios fuera de un tenant')
    return this.tenants.getReducedFeeThreshold(tenantId)
  }
}

function toSummary(
  owner: Owner,
  portfolio: OwnerPortfolio | undefined,
  threshold: number,
): OwnerSummaryView {
  const active = portfolio?.active ?? 0
  return {
    id: owner.id,
    firstName: owner.firstName,
    lastName: owner.lastName,
    fullName: fullNameOf(owner),
    nationalId: owner.nationalId,
    phone: owner.phone,
    email: owner.email,
    propertyCount: portfolio?.total ?? 0,
    activePropertyCount: active,
    reducedFee: appliesReducedFee(active, threshold),
    hasPortalAccess: owner.portalUserId !== null,
    createdAt: owner.createdAt,
    updatedAt: owner.updatedAt,
  }
}
