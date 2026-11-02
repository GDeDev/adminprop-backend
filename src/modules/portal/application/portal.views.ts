import type {
  InstallmentDetailView,
  InstallmentStatus,
  MoneyByCurrency,
  RenterArrearsView,
} from '@/modules/billing/public'
import type {
  CollectionMode,
  ContractStatus,
  Currency,
  DepositReturnMode,
  RentUpdateFrequency,
  RentUpdateType,
} from '@/modules/contracts/public'
import type { StatementSendMode } from '@/modules/owners/public'
import type { PropertyStatus } from '@/modules/properties/public'
import type { ContractServiceView } from '@/modules/services/public'
import type { SettlementSummaryView } from '@/modules/settlements/public'

/** Datos de la inmobiliaria que ven los portales (Fase 17/18, 4). */
export interface PortalAgencyView {
  name: string
  slug: string
  logoUrl: string | null
  primaryColor: string | null
  phone: string | null
  email: string | null
  /** Sólo dígitos, con código de país. */
  whatsapp: string | null
  address: string | null
  bankAccount: {
    holder: string | null
    bank: string | null
    cbu: string | null
    alias: string | null
  } | null
}

export interface PortalRenterMeView {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  agency: PortalAgencyView
}

export interface PortalRenterContractView {
  id: string
  status: ContractStatus
  property: { id: string; address: string; propertyType: string | null }
  startDate: string
  endDate: string
  currentRent: string
  currency: Currency
  rentUpdateType: RentUpdateType
  rentUpdateFrequency: RentUpdateFrequency
  nextRentUpdateOn: string | null
  deposit: string
  depositCurrency: Currency
  depositReturnMode: DepositReturnMode
  guarantor: { fullName: string } | null
  surety: { hasSurety: boolean; policyExpiresAt: string | null }
  services: ContractServiceView[]
  collectionMode: CollectionMode
  /** Sólo con `RENTER_PAYS_ON_BEHALF` (A-38). */
  feePaidByRenter: { feePercentage: string; feeAmount: string | null } | null
  timeline: {
    totalMonths: number
    elapsedMonths: number
    progressPercent: number
  }
}

export interface PortalRenterAccountView {
  contract: { id: string; status: ContractStatus } | null
  currentInstallment: InstallmentDetailView | null
  creditsAvailable: MoneyByCurrency[]
  arrears: RenterArrearsView
  paymentInstructions: {
    kind: CollectionMode
    bankAccount: PortalAgencyView['bankAccount']
  }
}

export interface PortalOwnerMeView {
  id: string
  fullName: string
  email: string | null
  bankAccount: {
    cbu: string | null
    alias: string | null
    bankName: string | null
    holder: string | null
  } | null
  statementSendMode: StatementSendMode
  agency: PortalAgencyView
}

export interface PortalOwnerPropertyView {
  id: string
  address: string
  status: PropertyStatus
  contract: {
    id: string
    renter: { fullName: string }
    startDate: string
    endDate: string
    currentRent: string
    currency: Currency
    collectionMode: CollectionMode
  } | null
  currentInstallment: {
    id: string
    period: string
    status: InstallmentStatus
    totalDue: string
    paidTotal: string
  } | null
}

export interface PortalOwnerAccountView {
  period: string
  properties: {
    property: { id: string; address: string }
    currency: Currency
    accrued: string
    collected: string
    pending: string
    lateFee: string
    settlements: SettlementSummaryView[]
  }[]
  fees: {
    currency: Currency
    accrued: string
    collected: string
    pending: string
  }[]
  totals: {
    currency: Currency
    accrued: string
    collected: string
    pending: string
    netSettled: string
    transferred: string
  }[]
}
