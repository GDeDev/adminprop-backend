import type {
  OverdueInstallmentRef,
  ReportInstallmentRef,
  ReportPaymentRef,
} from '@/modules/billing/public'
import type { ContractReportRef } from '@/modules/contracts/public'
import type { PropertyReportRef } from '@/modules/properties/public'
import type {
  ReportFeePaymentRef,
  ReportSettlementRef,
} from '@/modules/settlements/public'
import { IsoDate, Period, periodOf } from '@/shared/dates/calendar-date'
import { addMoney, toMoneyString } from '@/shared/money'
import {
  asCurrency,
  daysVacant,
  periodsBetween,
  sumByCurrency,
} from '../domain/report-calculations'
import {
  ArrearsReportRow,
  DashboardReport,
  IncomeReportRow,
  InstallmentBucket,
  PaymentReportRow,
  PropertyReportRow,
  REPORT_CURRENCY_ORDER,
  ReportCurrency,
} from '../domain/reports'

const ZERO = toMoneyString('0')

/**
 * Los cuatro grupos de cuotas del mes, según el estado que ve el usuario. El
 * importe de una cuota saldada es lo cobrado; el de las demás, lo que falta
 * cobrar (alquiler, cargos y punitorio a hoy). Por moneda (D-118).
 */
export function buildInstallmentBuckets(
  rows: ReportInstallmentRef[],
): DashboardReport['installments'] {
  const bucket = (
    status: string,
    amountOf: (row: ReportInstallmentRef) => string,
  ): InstallmentBucket => {
    const matching = rows.filter((row) => row.status === status)
    return {
      count: matching.length,
      amounts: sumByCurrency(
        matching.map((row) => ({
          currency: row.currency,
          amount: amountOf(row),
        })),
      ),
    }
  }
  return {
    paid: bucket('PAID', (row) => row.paidTotal),
    partial: bucket('PARTIAL', (row) => row.totalDue),
    pending: bucket('PENDING', (row) => row.totalDue),
    overdue: bucket('OVERDUE', (row) => row.totalDue),
  }
}

/** Devengado (alquiler base) y cobrado (alquiler imputado) de cada mes. */
export function buildHistory(
  periods: Period[],
  rows: ReportInstallmentRef[],
): DashboardReport['history'] {
  return periods.map((period) => {
    const ofPeriod = rows.filter((row) => row.period === period)
    return {
      period,
      accrued: sumByCurrency(
        ofPeriod.map((row) => ({
          currency: row.currency,
          amount: row.baseAmount,
        })),
      ),
      collected: sumByCurrency(
        ofPeriod.map((row) => ({
          currency: row.currency,
          amount: row.rentPaid,
        })),
      ),
    }
  })
}

type IncomeKey = `${Period}|${ReportCurrency}`

/**
 * Una fila por mes y moneda (A-38 del rediseño: "ingresos" por fecha de
 * pago). Cobrado: pagos confirmados por `paidAt`. Honorarios y neto: por el
 * mes de la liquidación (`settlements.period`), igual que el estado de cuenta
 * del propietario (D-115); los pagos de honorarios, por su fecha.
 */
export function buildIncomeRows(
  fromPeriod: Period,
  toPeriod: Period,
  payments: ReportPaymentRef[],
  settlements: ReportSettlementRef[],
  feePayments: ReportFeePaymentRef[],
): IncomeReportRow[] {
  const rows = new Map<IncomeKey, IncomeReportRow>()
  const rowFor = (period: Period, currencyValue: string): IncomeReportRow => {
    const currency = asCurrency(currencyValue)
    const key: IncomeKey = `${period}|${currency}`
    let row = rows.get(key)
    if (!row) {
      row = {
        period,
        currency,
        rentCollected: ZERO,
        lateFeesCollected: ZERO,
        chargesCollected: ZERO,
        feesAccrued: ZERO,
        feesCollected: ZERO,
        netSettled: ZERO,
        netTransferred: ZERO,
      }
      rows.set(key, row)
    }
    return row
  }
  const add = (current: string, amount: string) =>
    toMoneyString(addMoney(current, amount))

  for (const payment of payments) {
    const row = rowFor(periodOf(payment.paidAt), payment.currency)
    row.rentCollected = add(row.rentCollected, payment.rentApplied)
    row.lateFeesCollected = add(row.lateFeesCollected, payment.lateFeeApplied)
    row.chargesCollected = add(row.chargesCollected, payment.chargesApplied)
  }
  for (const settlement of settlements) {
    const row = rowFor(settlement.period, settlement.currency)
    row.feesAccrued = add(row.feesAccrued, settlement.feeTotal)
    if (settlement.feeDeducted) {
      row.feesCollected = add(row.feesCollected, settlement.feeTotal)
    }
    row.netSettled = add(row.netSettled, settlement.netAmount)
    for (const transfer of settlement.transfers) {
      row.netTransferred = add(row.netTransferred, transfer.amount)
    }
  }
  for (const payment of feePayments) {
    const row = rowFor(periodOf(payment.paidAt), payment.currency)
    row.feesCollected = add(row.feesCollected, payment.amount)
  }

  const inRange = new Set(periodsBetween(fromPeriod, toPeriod))
  return [...rows.values()]
    .filter((row) => inRange.has(row.period))
    .sort(
      (a, b) =>
        a.period.localeCompare(b.period) ||
        REPORT_CURRENCY_ORDER.indexOf(a.currency) -
          REPORT_CURRENCY_ORDER.indexOf(b.currency),
    )
}

export interface PaymentNames {
  renters: Map<string, { fullName: string }>
  properties: Map<string, { address: string }>
  owners: Map<string, { fullName: string }>
}

/** Pagos confirmados, el más reciente primero. */
export function buildPaymentRows(
  payments: ReportPaymentRef[],
  names: PaymentNames,
): PaymentReportRow[] {
  return [...payments]
    .sort(
      (a, b) =>
        b.paidAt.localeCompare(a.paidAt) ||
        a.paymentId.localeCompare(b.paymentId),
    )
    .map((payment) => ({
      paymentId: payment.paymentId,
      paidAt: payment.paidAt,
      period: payment.period,
      renterName: names.renters.get(payment.renterId)?.fullName ?? '-',
      propertyAddress: names.properties.get(payment.propertyId)?.address ?? '-',
      ownerName: names.owners.get(payment.ownerId)?.fullName ?? '-',
      amount: payment.amount,
      currency: asCurrency(payment.paidCurrency),
      method: payment.method,
      receivedBy: payment.receivedBy,
    }))
}

export interface ArrearsNames {
  renters: Map<string, { fullName: string; phone: string | null }>
  properties: Map<string, { address: string }>
  owners: Map<string, { fullName: string }>
}

/**
 * Deuda a la fecha: una fila por inquilino y propiedad con sus cuotas
 * vencidas (al menos `minDays` de atraso), el saldo y el punitorio por
 * moneda. Las más atrasadas primero.
 */
export function buildArrearsRows(
  overdue: OverdueInstallmentRef[],
  minDays: number,
  names: ArrearsNames,
): ArrearsReportRow[] {
  const groups = new Map<string, OverdueInstallmentRef[]>()
  for (const installment of overdue) {
    if (installment.daysOverdue < minDays) continue
    const key = `${installment.renterId}|${installment.propertyId}`
    groups.set(key, [...(groups.get(key) ?? []), installment])
  }
  return [...groups.values()]
    .map((group) => {
      const first = group[0]
      return {
        renterId: first.renterId,
        renterName: names.renters.get(first.renterId)?.fullName ?? '-',
        renterPhone: names.renters.get(first.renterId)?.phone ?? null,
        propertyAddress: names.properties.get(first.propertyId)?.address ?? '-',
        ownerName: names.owners.get(first.ownerId)?.fullName ?? '-',
        overdueInstallments: group.length,
        maxDaysOverdue: Math.max(...group.map((i) => i.daysOverdue)),
        balance: sumByCurrency(
          group.map((i) => ({ currency: i.currency, amount: i.totalDue })),
        ),
        lateFee: sumByCurrency(
          group.map((i) => ({
            currency: i.currency,
            amount: i.lateFeeBalance,
          })),
        ),
      }
    })
    .sort(
      (a, b) =>
        b.maxDaysOverdue - a.maxDaysOverdue ||
        a.renterName.localeCompare(b.renterName),
    )
}

export function totalsOf(rows: ArrearsReportRow[]) {
  return sumByCurrency(rows.flatMap((row) => row.balance))
}

/** Estado en el reporte: lo que no es alquilada ni disponible es "otra". */
function reportStatus(status: string): PropertyReportRow['status'] {
  return status === 'RENTED' || status === 'AVAILABLE' ? status : 'OTHER'
}

export interface PropertyNames {
  renters: Map<string, { fullName: string }>
}

/**
 * Propiedades alquiladas (con su inquilino, alquiler y fin del contrato
 * activo) o disponibles (con los días que llevan sin alquilarse).
 */
export function buildPropertyRows(
  properties: PropertyReportRef[],
  contracts: ContractReportRef[],
  names: PropertyNames,
  today: IsoDate,
  status?: 'RENTED' | 'AVAILABLE',
): PropertyReportRow[] {
  return properties
    .map((property): PropertyReportRow => {
      const mine = contracts.filter((c) => c.propertyId === property.id)
      const active = mine.find((c) => c.status === 'ACTIVE')
      const rowStatus = reportStatus(property.status)
      const base = {
        propertyId: property.id,
        address: property.address,
        status: rowStatus,
      }
      if (rowStatus === 'RENTED' && active) {
        return {
          ...base,
          renterName: names.renters.get(active.renterId)?.fullName ?? null,
          rent: {
            currency: asCurrency(active.currency),
            amount: toMoneyString(active.currentRent),
          },
          contractEndDate: active.endDate,
          daysVacant: null,
        }
      }
      return {
        ...base,
        renterName: null,
        rent: null,
        contractEndDate: null,
        daysVacant:
          rowStatus === 'AVAILABLE'
            ? daysVacant(
                mine
                  .filter((c) => c.status !== 'ACTIVE')
                  .map((c) => c.terminatedAt ?? c.endDate),
                property.createdAt,
                today,
              )
            : null,
      }
    })
    .filter((row) => !status || row.status === status)
}

/** Si el contrato ya tiene una renovación en marcha (otro contrato que lo renueva y no se rescindió). */
export function hasRenewal(
  contractId: string,
  contracts: ContractReportRef[],
): boolean {
  return contracts.some(
    (c) => c.renewedFromId === contractId && c.status !== 'TERMINATED',
  )
}
