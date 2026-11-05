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

/**
 * Lo cobrado en un mes y moneda, abierto por concepto. `total` es la suma de
 * los tres: alquiler + punitorios + cargos (D-235).
 */
export interface CollectedBreakdown {
  rent: string
  lateFees: string
  charges: string
  total: string
}

/**
 * Quién recibió la plata (Micaela #9 y #10): `agency` es lo que cobró la
 * inmobiliaria (y administra); `owner` es lo que percibió directamente el
 * propietario, que nunca pasó por la inmobiliaria.
 */
export interface CollectedByReceiver {
  agency: CollectedBreakdown
  owner: CollectedBreakdown
}

export interface IncomeReportRow {
  period: string
  currency: ReportCurrency
  /** Suma de lo cobrado por la inmobiliaria y lo percibido por el propietario. */
  rentCollected: string
  lateFeesCollected: string
  chargesCollected: string
  /** Lo mismo, separado por quién lo recibió. */
  collectedByReceiver: CollectedByReceiver
  feesAccrued: string
  feesCollected: string
  netSettled: string
  netTransferred: string
}

/** Total del rango para una moneda; las monedas nunca se mezclan (D-118). */
export interface IncomeReportTotal {
  currency: ReportCurrency
  collected: CollectedBreakdown
  collectedByReceiver: CollectedByReceiver
}

export interface IncomeReport extends ReportMeta {
  rows: IncomeReportRow[]
  /** Un total por moneda con movimientos, en el orden ARS, USD. */
  totals: IncomeReportTotal[]
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
