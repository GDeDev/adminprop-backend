import { Injectable } from '@nestjs/common'

import { fullNameOf } from '@/shared/people/person-policy'
import { GuaranteeType, Guarantor } from '../domain/guarantor'
import { GuarantorRepository } from '../domain/guarantor.ports'
import { PaymentStatus, Renter } from '../domain/renter'
import { RenterRepository } from '../domain/renter.ports'

export interface GuarantorRefView {
  id: string
  fullName: string
}

/** El garante dentro de la ficha del inquilino (spec 3.1, 5.2). */
export interface RenterGuarantorView extends GuarantorRefView {
  nationalId: string
  phone: string | null
  email: string | null
  guaranteeType: GuaranteeType
  guaranteeDetail: string
}

/** Una fila del listado (spec 5.1). */
export interface RenterSummaryView {
  id: string
  firstName: string
  lastName: string
  fullName: string
  nationalId: string
  phone: string | null
  email: string | null
  /** `AAAA-MM-DD` o null. */
  moveInDate: string | null
  guarantor: GuarantorRefView | null
  hasPortalAccess: boolean
  /** Contrato activo del que es titular, si lo hay. */
  activeContractId: string | null
  /** Siempre null hasta el motor de cobros (Fase 11). */
  paymentStatus: PaymentStatus | null
  createdAt: Date
  updatedAt: Date
}

/** Referencia al contrato activo: el detalle se pide a `GET /contracts/:id`. */
export interface RenterActiveContractView {
  id: string
}

/** La ficha (spec 3.1). Los pagos son un placeholder tipado (Fase 11). */
export interface RenterDetailView extends RenterSummaryView {
  address: string | null
  notes: string | null
  guarantor: RenterGuarantorView | null
  activeContract: RenterActiveContractView | null
  /** Siempre vacío hasta el motor de cobros (Fase 11). */
  payments: never[]
}

/** Una fila del listado de garantes (spec 5.4). */
export interface GuarantorSummaryView {
  id: string
  firstName: string
  lastName: string
  fullName: string
  nationalId: string
  phone: string | null
  email: string | null
  guaranteeType: GuaranteeType
  guaranteeDetail: string
  /** Inquilinos (no borrados) que garantiza. */
  renterCount: number
  createdAt: Date
  updatedAt: Date
}

/** La ficha del garante (spec 3.2): con los inquilinos que garantiza. */
export interface GuarantorDetailView extends GuarantorSummaryView {
  address: string | null
  notes: string | null
  renters: { id: string; fullName: string }[]
}

/**
 * Arma las vistas buscando los garantes de todos los inquilinos de la página
 * juntos: un listado de 20 hace una consulta de garantes, no 20.
 */
@Injectable()
export class RenterViews {
  constructor(
    private readonly renters: RenterRepository,
    private readonly guarantors: GuarantorRepository,
  ) {}

  async summaries(renters: Renter[]): Promise<RenterSummaryView[]> {
    const guarantors = await this.describeGuarantors(renters)
    return renters.map((renter) =>
      toRenterSummary(renter, guarantors.get(renter.guarantorId ?? '')),
    )
  }

  async detail(renter: Renter): Promise<RenterDetailView> {
    const guarantors = await this.describeGuarantors([renter])
    const guarantor = guarantors.get(renter.guarantorId ?? '')
    return {
      ...toRenterSummary(renter, guarantor),
      address: renter.address,
      notes: renter.notes,
      guarantor: guarantor ? toRenterGuarantor(guarantor) : null,
      activeContract: renter.activeContractId
        ? { id: renter.activeContractId }
        : null,
      payments: [],
    }
  }

  async guarantorSummaries(
    guarantors: Guarantor[],
  ): Promise<GuarantorSummaryView[]> {
    if (guarantors.length === 0) return []
    const counts = await this.renters.countByGuarantors(
      guarantors.map((g) => g.id),
    )
    return guarantors.map((guarantor) =>
      toGuarantorSummary(guarantor, counts.get(guarantor.id) ?? 0),
    )
  }

  async guarantorDetail(guarantor: Guarantor): Promise<GuarantorDetailView> {
    const renters = await this.renters.listByGuarantor(guarantor.id)
    return {
      ...toGuarantorSummary(guarantor, renters.length),
      address: guarantor.address,
      notes: guarantor.notes,
      renters: renters.map((renter) => ({
        id: renter.id,
        fullName: fullNameOf(renter),
      })),
    }
  }

  private async describeGuarantors(
    renters: Renter[],
  ): Promise<Map<string, Guarantor>> {
    const ids = renters.flatMap((r) => (r.guarantorId ? [r.guarantorId] : []))
    if (ids.length === 0) return new Map()
    const guarantors = await this.guarantors.findByIds([...new Set(ids)])
    return new Map(guarantors.map((g) => [g.id, g]))
  }
}

function toRenterSummary(
  renter: Renter,
  guarantor: Guarantor | undefined,
): RenterSummaryView {
  return {
    id: renter.id,
    firstName: renter.firstName,
    lastName: renter.lastName,
    fullName: fullNameOf(renter),
    nationalId: renter.nationalId,
    phone: renter.phone,
    email: renter.email,
    moveInDate: renter.moveInDate,
    guarantor: guarantor
      ? { id: guarantor.id, fullName: fullNameOf(guarantor) }
      : null,
    hasPortalAccess: renter.portalUserId !== null,
    activeContractId: renter.activeContractId,
    paymentStatus: null,
    createdAt: renter.createdAt,
    updatedAt: renter.updatedAt,
  }
}

function toRenterGuarantor(guarantor: Guarantor): RenterGuarantorView {
  return {
    id: guarantor.id,
    fullName: fullNameOf(guarantor),
    nationalId: guarantor.nationalId,
    phone: guarantor.phone,
    email: guarantor.email,
    guaranteeType: guarantor.guaranteeType,
    guaranteeDetail: guarantor.guaranteeDetail,
  }
}

function toGuarantorSummary(
  guarantor: Guarantor,
  renterCount: number,
): GuarantorSummaryView {
  return {
    id: guarantor.id,
    firstName: guarantor.firstName,
    lastName: guarantor.lastName,
    fullName: fullNameOf(guarantor),
    nationalId: guarantor.nationalId,
    phone: guarantor.phone,
    email: guarantor.email,
    guaranteeType: guarantor.guaranteeType,
    guaranteeDetail: guarantor.guaranteeDetail,
    renterCount,
    createdAt: guarantor.createdAt,
    updatedAt: guarantor.updatedAt,
  }
}
