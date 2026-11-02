/**
 * Formas de los reportes (Fase 19). Calzan con el contrato que fijó el
 * frontend (`shared-types/reports.ts`): cualquier cambio acá es un cambio de
 * contrato. Dinero siempre como string decimal y siempre por moneda.
 */
export type ReportCurrency = 'ARS' | 'USD'

export interface CurrencyAmount {
  currency: ReportCurrency
  amount: string
}

export interface ReportMeta {
  /** ISO 8601. */
  generatedAt: string
  /** Eco de los filtros pedidos, para el encabezado del export. */
  filters: Record<string, string | null>
}

export interface InstallmentBucket {
  count: number
  amounts: CurrencyAmount[]
}

export interface ExpiringContractRow {
  contractId: string
  propertyAddress: string
  renterName: string
  endDate: string
  daysLeft: number
  renewalInProgress: boolean
}

export interface DashboardReport extends ReportMeta {
  period: string
  installments: {
    paid: InstallmentBucket
    partial: InstallmentBucket
    pending: InstallmentBucket
    overdue: InstallmentBucket
  }
  lateFeesAccrued: CurrencyAmount[]
  lateFeesCollected: CurrencyAmount[]
  feesAccrued: CurrencyAmount[]
  todo: {
    paymentsToConfirm: number
    settlementsToConfirm: number
    settlementsToTransfer: number
    openStatements: number
    pendingIncreases: number
    unreadAlerts: number
  }
  expiringContracts: ExpiringContractRow[]
  /** Últimos 6 meses, el más viejo primero. */
  history: {
    period: string
    accrued: CurrencyAmount[]
    collected: CurrencyAmount[]
  }[]
}

export interface IncomeReportRow {
  period: string
  currency: ReportCurrency
  rentCollected: string
  lateFeesCollected: string
  chargesCollected: string
  feesAccrued: string
  feesCollected: string
  netSettled: string
  netTransferred: string
}

export interface IncomeReport extends ReportMeta {
  rows: IncomeReportRow[]
}

export interface PaymentReportRow {
  paymentId: string
  paidAt: string
  period: string
  renterName: string
  propertyAddress: string
  ownerName: string
  amount: string
  currency: ReportCurrency
  method: string
  receivedBy: 'AGENCY' | 'OWNER'
}

export interface ArrearsReportRow {
  renterId: string
  renterName: string
  renterPhone: string | null
  propertyAddress: string
  ownerName: string
  overdueInstallments: number
  maxDaysOverdue: number
  balance: CurrencyAmount[]
  lateFee: CurrencyAmount[]
}

export interface ArrearsReport extends ReportMeta {
  rows: ArrearsReportRow[]
  totals: CurrencyAmount[]
}

export interface PropertyReportRow {
  propertyId: string
  address: string
  status: 'RENTED' | 'AVAILABLE' | 'OTHER'
  renterName: string | null
  rent: CurrencyAmount | null
  contractEndDate: string | null
  daysVacant: number | null
}

export interface PropertiesReport extends ReportMeta {
  rows: PropertyReportRow[]
}

export interface ExpiringContractsReport extends ReportMeta {
  rows: ExpiringContractRow[]
}

export interface ServiceReportRow {
  serviceId: string
  propertyId: string
  propertyAddress: string
  serviceName: string
  daysOverdue: number
}

export interface ServicesReport extends ReportMeta {
  rows: ServiceReportRow[]
}

export const REPORT_CURRENCY_ORDER: ReportCurrency[] = ['ARS', 'USD']
