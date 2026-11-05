import { Injectable } from '@nestjs/common'

import { BillingFacade } from '@/modules/billing/public'
import { AutomationsFacade } from '@/modules/automations/public'
import { ContractsFacade } from '@/modules/contracts/public'
import { Catalog, MasterDataFacade } from '@/modules/master-data/public'
import { OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { ServicesFacade } from '@/modules/services/public'
import { SettlementsFacade } from '@/modules/settlements/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { IsoDate, periodOf, todayIso } from '@/shared/dates/calendar-date'
import {
  HISTORY_MONTHS,
  lastPeriods,
  resolveRange,
  sumByCurrency,
} from '../domain/report-calculations'
import {
  ArrearsReport,
  DashboardReport,
  ExpiringContractRow,
  ExpiringContractsReport,
  IncomeReport,
  PaymentReportRow,
  PropertiesReport,
  ReportMeta,
  ServicesReport,
} from '../domain/reports'
import {
  buildArrearsRows,
  buildIncomeRows,
  buildInstallmentBuckets,
  buildPaymentRows,
  buildPropertyRows,
  hasRenewal,
  totalsOf,
} from './report-builders'
import { buildHistoryFromTotals } from './report-history'

export interface PaymentsFilter {
  from?: string
  to?: string
  ownerId?: string
  propertyId?: string
  renterId?: string
}

/** Los pagos del reporte, completos (el listado los pagina y el export no). */
export interface PaymentsReportData extends ReportMeta {
  rows: PaymentReportRow[]
}

function tenantId(): string {
  const id = RequestContext.tenantId
  if (!id) throw new Error('Reporte sin inmobiliaria en el contexto')
  return id
}

/**
 * Arma los reportes (Fase 19) componiendo las facades de los módulos dueños
 * de cada dato. Sólo lectura: no hay tablas propias ni agregados guardados
 * (D-116); todo se calcula al leer. Dentro del tenant del contexto.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly billing: BillingFacade,
    private readonly settlements: SettlementsFacade,
    private readonly contracts: ContractsFacade,
    private readonly properties: PropertiesFacade,
    private readonly services: ServicesFacade,
    private readonly owners: OwnersFacade,
    private readonly renters: RentersFacade,
    private readonly masterData: MasterDataFacade,
    private readonly tenants: TenantsFacade,
    private readonly automations: AutomationsFacade,
  ) {}

  private meta(filters: Record<string, string | null>): ReportMeta {
    return { generatedAt: new Date().toISOString(), filters }
  }

  // ---------------------------------------------------------- Dashboard

  async dashboard(period?: string): Promise<DashboardReport> {
    const today = todayIso()
    const current = period ?? periodOf(today)
    const periods = lastPeriods(current, HISTORY_MONTHS)

    // Sólo las cuotas del mes se traen completas (estados, punitorio a hoy);
    // el historial de seis meses sale de totales sumados en la base.
    const [
      ofMonth,
      rentTotals,
      paymentsToConfirm,
      workload,
      due,
      unreadAlerts,
      expiringContracts,
    ] = await Promise.all([
      this.billing.reportInstallments({ period: current }, today),
      this.billing.reportRentTotals(periods[0], current),
      this.billing.countPaymentsToConfirm(),
      this.settlements.workload(),
      this.contracts.listDueForRentUpdate(today),
      this.automations.countUnreadAlerts(),
      this.expiringRows(undefined, today),
    ])

    return {
      ...this.meta({ period: current }),
      period: current,
      installments: buildInstallmentBuckets(ofMonth),
      lateFeesAccrued: sumByCurrency(
        ofMonth.map((i) => ({
          currency: i.currency,
          amount: i.lateFeeAccrued,
        })),
      ),
      lateFeesCollected: sumByCurrency(
        ofMonth.map((i) => ({ currency: i.currency, amount: i.lateFeePaid })),
      ),
      feesAccrued: sumByCurrency(
        ofMonth.map((i) => ({
          currency: i.currency,
          amount: i.feeOnCollected,
        })),
      ),
      todo: {
        paymentsToConfirm,
        settlementsToConfirm: workload.toConfirm,
        settlementsToTransfer: workload.toTransfer,
        openStatements: workload.openStatements,
        pendingIncreases: due.length,
        unreadAlerts,
      },
      expiringContracts,
      history: buildHistoryFromTotals(periods, rentTotals),
    }
  }

  // ------------------------------------------------------------- Ingresos

  async income(from?: string, to?: string): Promise<IncomeReport> {
    const range = resolveRange(from, to, todayIso())
    const [payments, settlements, feePayments] = await Promise.all([
      this.billing.reportPayments({
        from: range.fromDate,
        to: range.toDate,
      }),
      this.settlements.reportSettlements(range.fromPeriod, range.toPeriod),
      this.settlements.reportFeePayments(range.fromDate, range.toDate),
    ])
    return {
      ...this.meta({ from: range.fromPeriod, to: range.toPeriod }),
      rows: buildIncomeRows(
        range.fromPeriod,
        range.toPeriod,
        payments,
        settlements,
        feePayments,
      ),
    }
  }

  // ---------------------------------------------------------------- Pagos

  async payments(filter: PaymentsFilter): Promise<PaymentsReportData> {
    const range = resolveRange(filter.from, filter.to, todayIso())
    const payments = await this.billing.reportPayments({
      from: range.fromDate,
      to: range.toDate,
      ownerId: filter.ownerId,
      propertyId: filter.propertyId,
      renterId: filter.renterId,
    })
    const [renters, properties, owners] = await Promise.all([
      this.renters.describe(payments.map((p) => p.renterId)),
      this.properties.describe(payments.map((p) => p.propertyId)),
      this.owners.describe(payments.map((p) => p.ownerId)),
    ])
    return {
      ...this.meta({
        from: range.fromPeriod,
        to: range.toPeriod,
        ownerId: filter.ownerId ?? null,
        propertyId: filter.propertyId ?? null,
        renterId: filter.renterId ?? null,
      }),
      rows: buildPaymentRows(payments, { renters, properties, owners }),
    }
  }

  // ---------------------------------------------------------------- Mora

  async arrears(asOf?: IsoDate, minDays = 1): Promise<ArrearsReport> {
    const date = asOf ?? todayIso()
    const overdue = await this.billing.listOverdue(date)
    const [renters, properties, owners] = await Promise.all([
      this.renters.contacts(overdue.map((i) => i.renterId)),
      this.properties.describe(overdue.map((i) => i.propertyId)),
      this.owners.describe(overdue.map((i) => i.ownerId)),
    ])
    const rows = buildArrearsRows(overdue, minDays, {
      renters: new Map(
        [...renters].map(([id, renter]) => [
          id,
          { fullName: renter.fullName, phone: renter.phone },
        ]),
      ),
      properties,
      owners,
    })
    return {
      ...this.meta({ asOf: date, minDays: String(minDays) }),
      rows,
      totals: totalsOf(rows),
    }
  }

  // ----------------------------------------------------------- Propiedades

  async propertiesReport(
    status?: 'RENTED' | 'AVAILABLE',
  ): Promise<PropertiesReport> {
    const today = todayIso()
    const [properties, contracts] = await Promise.all([
      this.properties.listForReport(),
      this.contracts.listForReport(),
    ])
    const renters = await this.renters.describe(
      contracts.filter((c) => c.status === 'ACTIVE').map((c) => c.renterId),
    )
    return {
      ...this.meta({ status: status ?? null }),
      rows: buildPropertyRows(
        properties,
        contracts,
        { renters },
        today,
        status,
      ),
    }
  }

  // ------------------------------------------------------ Contratos por vencer

  async expiring(withinDays?: number): Promise<ExpiringContractsReport> {
    const today = todayIso()
    const days =
      withinDays ??
      (await this.tenants.getContractSettings(tenantId()))
        .contractExpiryNoticeDays
    return {
      ...this.meta({ withinDays: String(days) }),
      rows: await this.expiringRows(days, today),
    }
  }

  /** Los activos que terminan dentro de `days` días (por defecto, el aviso de la inmobiliaria). */
  private async expiringRows(
    withinDays: number | undefined,
    today: IsoDate,
  ): Promise<ExpiringContractRow[]> {
    const days =
      withinDays ??
      (await this.tenants.getContractSettings(tenantId()))
        .contractExpiryNoticeDays
    const expiring = await this.contracts.listExpiringWithin(days, today)
    if (expiring.length === 0) return []
    const [all, properties, renters] = await Promise.all([
      this.contracts.listForReport(),
      this.properties.describe(expiring.map((c) => c.propertyId)),
      this.renters.describe(expiring.map((c) => c.renterId)),
    ])
    return expiring.map((contract) => ({
      contractId: contract.id,
      propertyAddress: properties.get(contract.propertyId)?.address ?? '-',
      renterName: renters.get(contract.renterId)?.fullName ?? '-',
      endDate: contract.endDate,
      daysLeft: contract.daysLeft,
      renewalInProgress: hasRenewal(contract.id, all),
    }))
  }

  // -------------------------------------------------------------- Servicios

  async servicesReport(
    status: 'overdue' | 'all' = 'overdue',
  ): Promise<ServicesReport> {
    const overdue = await this.services.listOverdue(todayIso())
    const [properties, types] = await Promise.all([
      this.properties.describe(overdue.map((s) => s.propertyId)),
      this.masterData.describeCatalog(
        Catalog.SERVICE_TYPES,
        overdue.map((s) => s.serviceTypeId),
      ),
    ])
    return {
      ...this.meta({ status }),
      rows: overdue.map((service) => ({
        serviceId: service.id,
        propertyId: service.propertyId,
        propertyAddress: properties.get(service.propertyId)?.address ?? '-',
        serviceName: types.get(service.serviceTypeId)?.name ?? 'Servicio',
        daysOverdue: service.daysOverdue,
      })),
    }
  }
}
