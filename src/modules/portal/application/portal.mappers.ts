import type {
  InstallmentDetailView,
  InstallmentSummaryView,
} from '@/modules/billing/public'
import type {
  ContractDetailView,
  ContractSummaryView,
  Currency,
} from '@/modules/contracts/public'
import type { OwnerPropertySummary } from '@/modules/properties/public'
import type { ContractServiceView } from '@/modules/services/public'
import type {
  FeeAccountTotals,
  OwnerStatementDetailView,
  SettlementDetailView,
  SettlementSummaryView,
} from '@/modules/settlements/public'
import type { TenantBrandingData } from '@/modules/tenants/public'
import {
  addMoney,
  compareMoney,
  subtractMoney,
  toMoneyString,
} from '@/shared/money'
import type {
  PortalAgencyView,
  PortalOwnerAccountView,
  PortalOwnerPropertyView,
  PortalRenterContractView,
} from './portal.views'

const ZERO = '0.00'

// ------------------------------------------------------------ Inmobiliaria

export function toAgency(branding: TenantBrandingData): PortalAgencyView {
  const hasBank = [
    branding.bankAccountHolder,
    branding.bankName,
    branding.bankCbu,
    branding.bankAlias,
  ].some((value) => value !== null)
  return {
    name: branding.name,
    slug: branding.slug,
    logoUrl: branding.logoUrl,
    primaryColor: branding.primaryColor,
    phone: branding.phone,
    email: branding.email,
    whatsapp: branding.whatsapp,
    address: branding.address,
    bankAccount: hasBank
      ? {
          holder: branding.bankAccountHolder,
          bank: branding.bankName,
          cbu: branding.bankCbu,
          alias: branding.bankAlias,
        }
      : null,
  }
}

// ---------------------------------------------------------------- Inquilino

/**
 * Los honorarios de la inmobiliaria sólo se muestran cuando el inquilino los
 * paga por cuenta del propietario (A-38); en cualquier otro caso van en cero.
 */
function feesVisibleToRenter(feeMode: string): boolean {
  return feeMode === 'RENTER_PAYS_ON_BEHALF'
}

/** La cuota en el listado del inquilino: sin el propietario. */
export function maskInstallmentSummaryForRenter(
  installment: InstallmentSummaryView,
): InstallmentSummaryView {
  return { ...installment, owner: null }
}

/**
 * La ficha de la cuota tal como la ve el inquilino: sin quién registró,
 * confirmó o anuló, sin notas ni motivos internos, sin la liquidación al
 * propietario y sin los honorarios (salvo A-38). La API manda esos campos en
 * `null` en vez de sacarlos, así el tipo es el mismo que el del backoffice.
 */
export function maskInstallmentDetailForRenter(
  installment: InstallmentDetailView,
): InstallmentDetailView {
  const showFees = feesVisibleToRenter(installment.feeMode)
  return {
    ...installment,
    owner: null,
    feePercentage: showFees ? installment.feePercentage : ZERO,
    feeAmount: showFees ? installment.feeAmount : null,
    feeOnBase: showFees ? installment.feeOnBase : ZERO,
    feeOnCollected: showFees ? installment.feeOnCollected : ZERO,
    charges: installment.charges.map((charge) => ({
      ...charge,
      createdBy: null,
      voidReason: null,
    })),
    payments: installment.payments.map((payment) => ({
      ...payment,
      notes: null,
      registeredBy: null,
      confirmedBy: null,
      voidedBy: null,
      voidReason: null,
      settlementId: null,
    })),
    lateFeeAdjustments: installment.lateFeeAdjustments.map((adjustment) => ({
      ...adjustment,
      reason: '',
      createdBy: null,
    })),
    notes: null,
  }
}

export function toRenterContract(
  contract: ContractDetailView,
  services: ContractServiceView[],
  propertyType: string | null,
): PortalRenterContractView {
  const terms = contract.billingTerms
  return {
    id: contract.id,
    status: contract.status,
    property: {
      id: contract.property?.id ?? '',
      address: contract.property?.address ?? '',
      propertyType,
    },
    startDate: contract.startDate,
    endDate: contract.endDate,
    currentRent: contract.currentRent,
    currency: contract.currency,
    rentUpdateType: contract.rentUpdateType,
    rentUpdateFrequency: contract.rentUpdateFrequency,
    nextRentUpdateOn: contract.nextRentUpdateOn,
    deposit: contract.deposit,
    depositCurrency: contract.depositCurrency,
    depositReturnMode: contract.depositReturnMode,
    guarantor: contract.guarantor
      ? { fullName: contract.guarantor.fullName }
      : null,
    surety: {
      hasSurety: contract.hasSurety,
      policyExpiresAt: contract.policyExpiresAt,
    },
    // Las notas de un servicio son internas.
    services: services.map((service) => ({ ...service, notes: null })),
    collectionMode: terms.collectionMode,
    feePaidByRenter: feesVisibleToRenter(terms.feeMode)
      ? { feePercentage: terms.feePercentage, feeAmount: terms.feeAmount }
      : null,
    timeline: contract.timeline,
  }
}

// -------------------------------------------------------------- Propietario

/**
 * La liquidación como la ve el propietario: sin quién la confirmó, registró
 * ajustes o transferencias, ni notas ni motivos internos.
 */
export function maskSettlementDetailForOwner(
  settlement: SettlementDetailView,
): SettlementDetailView {
  return {
    ...settlement,
    skippedExpenses: [],
    adjustments: settlement.adjustments.map((adjustment) => ({
      ...adjustment,
      createdBy: null,
      voidReason: null,
    })),
    transfers: settlement.transfers.map((transfer) => ({
      ...transfer,
      notes: null,
      registeredBy: null,
    })),
    confirmedBy: null,
    cancelReason: null,
    notes: null,
  }
}

export function maskStatementDetailForOwner(
  statement: OwnerStatementDetailView,
): OwnerStatementDetailView {
  return { ...statement, closedBy: null, notes: null }
}

/** Sus propiedades con el contrato activo y la cuota del mes de cada una. */
export function toOwnerProperties(
  properties: OwnerPropertySummary[],
  contracts: ContractSummaryView[],
  installments: InstallmentSummaryView[],
): PortalOwnerPropertyView[] {
  return properties.map((property) => {
    const contract = contracts.find((c) => c.property?.id === property.id)
    const installment = contract
      ? installments.find((i) => i.contract.id === contract.id)
      : undefined
    return {
      id: property.id,
      address: property.address,
      status: property.status,
      contract: contract
        ? {
            id: contract.id,
            renter: { fullName: contract.renter?.fullName ?? '' },
            startDate: contract.startDate,
            endDate: contract.endDate,
            currentRent: contract.currentRent,
            currency: contract.currency,
            collectionMode: contract.collectionMode,
          }
        : null,
      currentInstallment: installment
        ? {
            id: installment.id,
            period: installment.period,
            status: installment.status,
            totalDue: installment.totalDue,
            paidTotal: installment.paidTotal,
          }
        : null,
    }
  })
}

interface Amounts {
  accrued: string
  collected: string
  pending: string
  lateFee: string
}

const emptyAmounts = (): Amounts => ({
  accrued: ZERO,
  collected: ZERO,
  pending: ZERO,
  lateFee: ZERO,
})

/** El punitorio vigente de una cuota: devengado menos lo reducido, o cero si se condonó. */
function netLateFee(installment: InstallmentSummaryView): string {
  if (installment.lateFeeWaived) return ZERO
  const net = toMoneyString(
    subtractMoney(installment.lateFeeAccrued, installment.lateFeeAdjusted),
  )
  return compareMoney(net, ZERO) < 0 ? ZERO : net
}

function addInstallment(
  amounts: Amounts,
  installment: InstallmentSummaryView,
): Amounts {
  return {
    accrued: toMoneyString(addMoney(amounts.accrued, installment.baseAmount)),
    collected: toMoneyString(
      addMoney(
        amounts.collected,
        subtractMoney(installment.baseAmount, installment.rentBalance),
      ),
    ),
    pending: toMoneyString(addMoney(amounts.pending, installment.rentBalance)),
    lateFee: toMoneyString(addMoney(amounts.lateFee, netLateFee(installment))),
  }
}

/**
 * El estado de cuenta del mes del propietario (Fase 17, 1.2): por propiedad
 * y moneda, el alquiler devengado, cobrado y pendiente, el punitorio y las
 * liquidaciones del mes; totales por moneda y la cuenta de honorarios.
 * Sólo cuenta lo suyo: las cuotas y las liquidaciones ya vienen filtradas por
 * propietario, y los honorarios son los de su propia cuenta.
 */
export function buildOwnerAccount(
  period: string,
  installments: InstallmentSummaryView[],
  settlements: SettlementSummaryView[],
  fees: FeeAccountTotals[],
): PortalOwnerAccountView {
  const rows = new Map<
    string,
    {
      property: { id: string; address: string }
      currency: Currency
      amounts: Amounts
      settlements: SettlementSummaryView[]
    }
  >()
  const totals = new Map<
    Currency,
    { amounts: Amounts; netSettled: string; transferred: string }
  >()
  const totalsOf = (currency: Currency) => {
    const found = totals.get(currency)
    if (found) return found
    const created = {
      amounts: emptyAmounts(),
      netSettled: ZERO,
      transferred: ZERO,
    }
    totals.set(currency, created)
    return created
  }
  const rowOf = (
    property: { id: string; address: string },
    currency: Currency,
  ) => {
    const key = `${property.id}|${currency}`
    const found = rows.get(key)
    if (found) return found
    const created = {
      property,
      currency,
      amounts: emptyAmounts(),
      settlements: [] as SettlementSummaryView[],
    }
    rows.set(key, created)
    return created
  }

  for (const installment of installments) {
    const currency = installment.currency as unknown as Currency
    const total = totalsOf(currency)
    total.amounts = addInstallment(total.amounts, installment)
    if (installment.property) {
      const row = rowOf(installment.property, currency)
      row.amounts = addInstallment(row.amounts, installment)
    }
  }
  for (const settlement of settlements) {
    const currency = settlement.currency as unknown as Currency
    const total = totalsOf(currency)
    total.netSettled = toMoneyString(
      addMoney(total.netSettled, settlement.netAmount),
    )
    total.transferred = toMoneyString(
      addMoney(total.transferred, settlement.transferredTotal),
    )
    if (settlement.property) {
      rowOf(settlement.property, currency).settlements.push(settlement)
    }
  }

  return {
    period,
    properties: [...rows.values()]
      .sort((a, b) => a.property.address.localeCompare(b.property.address))
      .map(({ amounts, ...row }) => ({ ...row, ...amounts })),
    fees: fees.map(({ currency, accrued, collected, pending }) => ({
      currency: currency as unknown as Currency,
      accrued,
      collected,
      pending,
    })),
    totals: [...totals.entries()].map(([currency, value]) => ({
      currency,
      accrued: value.amounts.accrued,
      collected: value.amounts.collected,
      pending: value.amounts.pending,
      netSettled: value.netSettled,
      transferred: value.transferred,
    })),
  }
}
