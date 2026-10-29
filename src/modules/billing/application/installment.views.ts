import { Injectable } from '@nestjs/common'

import { UserRef, UsersFacade } from '@/modules/auth/public'
import { OwnerRef, OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade, PropertyRef } from '@/modules/properties/public'
import { RenterRef, RentersFacade } from '@/modules/renters/public'
import { IsoDate, Period, todayIso } from '@/shared/dates/calendar-date'
import { addMoney, toMoneyString } from '@/shared/money'
import {
  ChargeConcept,
  CollectionMode,
  CreditStatus,
  Currency,
  ExchangeRateSource,
  FeeMode,
  Installment,
  InstallmentStatus,
  LateFeeAdjustmentKind,
  LateFeeDay,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
  RenterCredit,
} from '../domain/billing'
import { RenterCreditRepository } from '../domain/billing.ports'
import {
  InstallmentBalances,
  InstallmentPolicy,
} from '../domain/installment.policy'
import { ArrearsStatus } from './account-movement-type'

export { ArrearsStatus }

/** Una cuota en el listado (5, `GET /billing/installments`). Montos como string. */
export interface InstallmentSummaryView {
  id: string
  period: Period
  contract: { id: string }
  /** Null si la propiedad, el inquilino o el propietario se borraron. */
  property: PropertyRef | null
  renter: RenterRef | null
  owner: OwnerRef | null
  currency: Currency
  baseAmount: string
  chargesTotal: string
  lateFeeAccrued: string
  lateFeeAdjusted: string
  lateFeeWaived: boolean
  lateFeeBalance: string
  paidTotal: string
  rentBalance: string
  chargesBalance: string
  totalDue: string
  pendingConfirmationTotal: string
  status: InstallmentStatus
  graceEndDate: IsoDate
  feeDays: number
  paidAt: IsoDate | null
  collectionMode: CollectionMode
  feeMode: FeeMode
  createdAt: Date
}

export interface InstallmentChargeView {
  id: string
  concept: ChargeConcept
  description: string
  amount: string
  createdBy: UserRef | null
  createdAt: Date
  voidedAt: Date | null
  voidReason: string | null
}

export interface PaymentView {
  id: string
  installmentId: string
  contractId: string
  renterId: string
  period: Period
  paidAt: IsoDate
  paidCurrency: Currency
  amount: string
  exchangeRate: string | null
  exchangeRateSource: ExchangeRateSource | null
  exchangeRateDate: IsoDate | null
  amountInContractCurrency: string
  kind: PaymentKind
  method: PaymentMethod
  receivedBy: PaymentReceiver
  status: PaymentStatus
  lateFeeApplied: string
  rentApplied: string
  chargesApplied: string
  creditGenerated: string
  creditId: string | null
  receiptUrl: string | null
  notes: string | null
  registeredBy: UserRef | null
  confirmedAt: Date | null
  confirmedBy: UserRef | null
  voidedAt: Date | null
  voidedBy: UserRef | null
  voidReason: string | null
  /** Liquidación que lo incluyó (Fase 12); null = sin liquidar. */
  settlementId: string | null
  createdAt: Date
}

/** Un pago en el listado general, con inquilino, propiedad y moneda del contrato. */
export interface PaymentListItemView extends PaymentView {
  renter: RenterRef | null
  property: PropertyRef | null
  currency: Currency
}

export interface LateFeeAdjustmentView {
  id: string
  kind: LateFeeAdjustmentKind
  amount: string
  reason: string
  createdBy: UserRef | null
  createdAt: Date
}

export type LateFeeDayView = LateFeeDay

/** La ficha de la cuota. */
export interface InstallmentDetailView extends InstallmentSummaryView {
  lateFeePercentage: string
  lateFeeGraceDays: number
  feePercentage: string
  feeAmount: string | null
  feeOnBase: string
  feeOnCollected: string
  charges: InstallmentChargeView[]
  /** Más nuevos primero. */
  payments: PaymentView[]
  lateFeeAdjustments: LateFeeAdjustmentView[]
  lateFeeDays: LateFeeDayView[]
  /** Saldo a favor disponible del inquilino en la moneda del contrato. */
  creditsAvailable: string
  notes: string | null
  updatedAt: Date
}

/** Desglose a una fecha (spec 3.4). */
export interface InstallmentBreakdownView {
  installmentId: string
  period: Period
  currency: Currency
  asOf: IsoDate
  status: InstallmentStatus
  baseAmount: string
  chargesTotal: string
  graceEndDate: IsoDate
  feeDays: number
  lateFeePercentage: string
  lateFeeAccrued: string
  lateFeeAdjusted: string
  lateFeeWaived: boolean
  rentPaid: string
  chargesPaid: string
  lateFeePaid: string
  rentBalance: string
  chargesBalance: string
  lateFeeBalance: string
  totalDue: string
  creditAvailable: string
  /** Lo que queda por entregar si se aplica el crédito disponible. */
  totalDueAfterCredit: string
  days: LateFeeDayView[]
}

export interface BillingSummaryByCurrencyView {
  currency: Currency
  total: number
  pending: number
  partial: number
  overdue: number
  paid: number
  baseTotal: string
  chargesTotal: string
  collectedTotal: string
  collectedByAgency: string
  collectedByOwner: string
  pendingConfirmationTotal: string
  lateFeeAccrued: string
  lateFeeCollected: string
  feeAccruedOnBase: string
  feeAccruedOnCollected: string
  balanceTotal: string
}

export interface BillingSummaryView {
  period: Period
  byCurrency: BillingSummaryByCurrencyView[]
}

export interface RenterCreditView {
  id: string
  renterId: string
  contractId: string
  currency: Currency
  amount: string
  remaining: string
  status: CreditStatus
  originPaymentId: string
  createdAt: Date
  refundedAt: IsoDate | null
  refundMethod: PaymentMethod | null
  refundNotes: string | null
}

export interface RenterCreditsView {
  renterId: string
  totals: { currency: Currency; available: string }[]
  /** Todos, más nuevos primero. */
  credits: RenterCreditView[]
}

export interface MoneyByCurrency {
  currency: Currency
  amount: string
}

/** Mora de un inquilino (spec 5.2; reemplaza el `paymentStatus: null` de D-46). */
export interface RenterArrearsView {
  renterId: string
  status: ArrearsStatus
  overdueInstallments: number
  maxDaysOverdue: number
  lateFeeAccrued: MoneyByCurrency[]
  balance: MoneyByCurrency[]
}

export interface Parties {
  properties: Map<string, PropertyRef>
  renters: Map<string, RenterRef>
  owners: Map<string, OwnerRef>
}

const ZERO = toMoneyString('0')

export function sumMoney(values: string[]): string {
  return toMoneyString(addMoney(ZERO, ...values))
}

/** Suma por moneda, sin mezclar. */
export function sumByCurrency(
  items: { currency: Currency; amount: string }[],
): MoneyByCurrency[] {
  const totals = new Map<Currency, string[]>()
  for (const item of items) {
    totals.set(item.currency, [
      ...(totals.get(item.currency) ?? []),
      item.amount,
    ])
  }
  return [...totals.entries()].map(([currency, amounts]) => ({
    currency,
    amount: sumMoney(amounts),
  }))
}

export function toSummary(
  installment: Installment,
  balances: InstallmentBalances,
  parties: Parties,
  today: IsoDate,
): InstallmentSummaryView {
  return {
    id: installment.id,
    period: installment.period,
    contract: { id: installment.contractId },
    property: parties.properties.get(installment.propertyId) ?? null,
    renter: parties.renters.get(installment.renterId) ?? null,
    owner: parties.owners.get(installment.ownerId) ?? null,
    currency: installment.currency,
    baseAmount: balances.baseAmount,
    chargesTotal: balances.chargesTotal,
    lateFeeAccrued: balances.lateFeeAccrued,
    lateFeeAdjusted: balances.lateFeeAdjusted,
    lateFeeWaived: balances.lateFeeWaived,
    lateFeeBalance: balances.lateFeeBalance,
    paidTotal: balances.paidTotal,
    rentBalance: balances.rentBalance,
    chargesBalance: balances.chargesBalance,
    totalDue: balances.totalDue,
    pendingConfirmationTotal: balances.pendingConfirmationTotal,
    status: InstallmentPolicy.displayStatus(installment, balances, today),
    graceEndDate: installment.graceEndDate,
    feeDays: balances.feeDays,
    paidAt: installment.paidAt,
    collectionMode: installment.collectionMode,
    feeMode: installment.feeMode,
    createdAt: installment.createdAt,
  }
}

export function toPaymentView(
  payment: Payment,
  period: Period,
  users: Map<string, UserRef>,
): PaymentView {
  const user = (id: string | null) => (id && users.get(id)) || null
  return {
    id: payment.id,
    installmentId: payment.installmentId,
    contractId: payment.contractId,
    renterId: payment.renterId,
    period,
    paidAt: payment.paidAt,
    paidCurrency: payment.paidCurrency,
    amount: payment.amount,
    exchangeRate: payment.exchangeRate,
    exchangeRateSource: payment.exchangeRateSource,
    exchangeRateDate: payment.exchangeRateDate,
    amountInContractCurrency: payment.amountInContractCurrency,
    kind: payment.kind,
    method: payment.method,
    receivedBy: payment.receivedBy,
    status: payment.status,
    lateFeeApplied: payment.lateFeeApplied,
    rentApplied: payment.rentApplied,
    chargesApplied: payment.chargesApplied,
    creditGenerated: payment.creditGenerated,
    creditId: payment.creditId,
    receiptUrl: payment.receiptUrl,
    notes: payment.notes,
    registeredBy: user(payment.registeredById),
    confirmedAt: payment.confirmedAt,
    confirmedBy: user(payment.confirmedById),
    voidedAt: payment.voidedAt,
    voidedBy: user(payment.voidedById),
    voidReason: payment.voidReason,
    settlementId: payment.settlementId,
    createdAt: payment.createdAt,
  }
}

export function toCreditView(credit: RenterCredit): RenterCreditView {
  return {
    id: credit.id,
    renterId: credit.renterId,
    contractId: credit.contractId,
    currency: credit.currency,
    amount: credit.amount,
    remaining: credit.remaining,
    status: credit.status,
    originPaymentId: credit.originPaymentId,
    createdAt: credit.createdAt,
    refundedAt: credit.refundedAt,
    refundMethod: credit.refundMethod,
    refundNotes: credit.refundNotes,
  }
}

/** Ids de usuario que aparecen en una cuota (quién cargó, cobró, confirmó, anuló). */
function userIdsOf(installment: Installment): string[] {
  return [
    ...installment.charges.flatMap((c) => [c.createdById, c.voidedById]),
    ...installment.payments.flatMap((p) => [
      p.registeredById,
      p.confirmedById,
      p.voidedById,
    ]),
    ...installment.adjustments.map((a) => a.createdById),
  ].filter((id): id is string => id !== null)
}

/**
 * Arma las vistas resolviendo propiedad, inquilino, propietario y usuarios
 * por las facades de sus módulos, una consulta por módulo. Los saldos y el
 * estado se calculan al momento (D-71), nunca se guardan.
 */
@Injectable()
export class InstallmentViews {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly renters: RentersFacade,
    private readonly owners: OwnersFacade,
    private readonly users: UsersFacade,
    private readonly creditRepository: RenterCreditRepository,
  ) {}

  async describeParties(
    refs: { propertyId: string; renterId: string; ownerId: string }[],
  ): Promise<Parties> {
    const [properties, renters, owners] = await Promise.all([
      this.properties.describe(refs.map((r) => r.propertyId)),
      this.renters.describe(refs.map((r) => r.renterId)),
      this.owners.describe(refs.map((r) => r.ownerId)),
    ])
    return { properties, renters, owners }
  }

  async summaries(
    installments: Installment[],
    today: IsoDate = todayIso(),
  ): Promise<InstallmentSummaryView[]> {
    if (installments.length === 0) return []
    const parties = await this.describeParties(installments)
    return installments.map((installment) =>
      toSummary(
        installment,
        InstallmentPolicy.balances(installment, today),
        parties,
        today,
      ),
    )
  }

  async detail(
    installment: Installment,
    today: IsoDate = todayIso(),
  ): Promise<InstallmentDetailView> {
    const [parties, users, available] = await Promise.all([
      this.describeParties([installment]),
      this.users.describe(userIdsOf(installment)),
      this.creditRepository.listAvailable(
        installment.renterId,
        installment.currency,
      ),
    ])
    const balances = InstallmentPolicy.balances(installment, today)
    const fees = InstallmentPolicy.feeAccrual(installment)
    const user = (id: string | null) => (id && users.get(id)) || null
    return {
      ...toSummary(installment, balances, parties, today),
      lateFeePercentage: installment.lateFeePercentage,
      lateFeeGraceDays: installment.lateFeeGraceDays,
      feePercentage: installment.feePercentage,
      feeAmount: installment.feeAmount,
      feeOnBase: fees.feeOnBase,
      feeOnCollected: fees.feeOnCollected,
      charges: installment.charges.map((charge) => ({
        id: charge.id,
        concept: charge.concept,
        description: charge.description,
        amount: charge.amount,
        createdBy: user(charge.createdById),
        createdAt: charge.createdAt,
        voidedAt: charge.voidedAt,
        voidReason: charge.voidReason,
      })),
      payments: installment.payments.map((payment) =>
        toPaymentView(payment, installment.period, users),
      ),
      lateFeeAdjustments: installment.adjustments.map((adjustment) => ({
        id: adjustment.id,
        kind: adjustment.kind,
        amount: adjustment.amount,
        reason: adjustment.reason,
        createdBy: user(adjustment.createdById),
        createdAt: adjustment.createdAt,
      })),
      // Saldada, manda el detalle congelado (A-4); impaga, el calculado a hoy.
      lateFeeDays:
        installment.frozenFeeDays.length > 0
          ? installment.frozenFeeDays
          : balances.days,
      creditsAvailable: sumMoney(available.map((c) => c.remaining)),
      notes: installment.notes,
      updatedAt: installment.updatedAt,
    }
  }

  async breakdown(
    installment: Installment,
    asOf: IsoDate,
    today: IsoDate = todayIso(),
  ): Promise<InstallmentBreakdownView> {
    const available = await this.creditRepository.listAvailable(
      installment.renterId,
      installment.currency,
    )
    const balances = InstallmentPolicy.balances(installment, asOf)
    const creditAvailable = sumMoney(available.map((c) => c.remaining))
    const applicable =
      Number(creditAvailable) > Number(balances.totalDue)
        ? balances.totalDue
        : creditAvailable
    return {
      installmentId: installment.id,
      period: installment.period,
      currency: installment.currency,
      asOf,
      status: InstallmentPolicy.displayStatus(installment, balances, today),
      baseAmount: balances.baseAmount,
      chargesTotal: balances.chargesTotal,
      graceEndDate: installment.graceEndDate,
      feeDays: balances.feeDays,
      lateFeePercentage: installment.lateFeePercentage,
      lateFeeAccrued: balances.lateFeeAccrued,
      lateFeeAdjusted: balances.lateFeeAdjusted,
      lateFeeWaived: balances.lateFeeWaived,
      rentPaid: balances.rentPaid,
      chargesPaid: balances.chargesPaid,
      lateFeePaid: balances.lateFeePaid,
      rentBalance: balances.rentBalance,
      chargesBalance: balances.chargesBalance,
      lateFeeBalance: balances.lateFeeBalance,
      totalDue: balances.totalDue,
      creditAvailable,
      totalDueAfterCredit: toMoneyString(
        addMoney(balances.totalDue, `-${applicable}`),
      ),
      days: balances.days,
    }
  }

  /** Resumen del mes por moneda (5, `GET /billing/installments/summary`). */
  summary(
    period: Period,
    installments: Installment[],
    today: IsoDate = todayIso(),
  ): BillingSummaryView {
    const groups = new Map<Currency, Installment[]>()
    for (const installment of installments) {
      groups.set(installment.currency, [
        ...(groups.get(installment.currency) ?? []),
        installment,
      ])
    }
    const byCurrency = [...groups.entries()].map(([currency, group]) => {
      const rows = group.map((installment) => ({
        installment,
        balances: InstallmentPolicy.balances(installment, today),
        fees: InstallmentPolicy.feeAccrual(installment),
      }))
      const statuses = rows.map((r) =>
        InstallmentPolicy.displayStatus(r.installment, r.balances, today),
      )
      const count = (status: InstallmentStatus) =>
        statuses.filter((s) => s === status).length
      const collectedBy = (receiver: PaymentReceiver) =>
        sumMoney(
          group.flatMap((i) =>
            i.payments
              .filter(
                (p) =>
                  p.status !== PaymentStatus.VOIDED &&
                  p.kind === PaymentKind.CASH_IN &&
                  p.receivedBy === receiver,
              )
              .map((p) =>
                sumMoney([p.lateFeeApplied, p.rentApplied, p.chargesApplied]),
              ),
          ),
        )
      return {
        currency,
        total: rows.length,
        pending: count(InstallmentStatus.PENDING),
        partial: count(InstallmentStatus.PARTIAL),
        overdue: count(InstallmentStatus.OVERDUE),
        paid: count(InstallmentStatus.PAID),
        baseTotal: sumMoney(rows.map((r) => r.balances.baseAmount)),
        chargesTotal: sumMoney(rows.map((r) => r.balances.chargesTotal)),
        collectedTotal: sumMoney(rows.map((r) => r.balances.paidTotal)),
        collectedByAgency: collectedBy(PaymentReceiver.AGENCY),
        collectedByOwner: collectedBy(PaymentReceiver.OWNER),
        pendingConfirmationTotal: sumMoney(
          rows.map((r) => r.balances.pendingConfirmationTotal),
        ),
        lateFeeAccrued: sumMoney(rows.map((r) => r.balances.lateFeeAccrued)),
        lateFeeCollected: sumMoney(rows.map((r) => r.balances.lateFeePaid)),
        feeAccruedOnBase: sumMoney(rows.map((r) => r.fees.feeOnBase)),
        feeAccruedOnCollected: sumMoney(rows.map((r) => r.fees.feeOnCollected)),
        balanceTotal: sumMoney(rows.map((r) => r.balances.totalDue)),
      }
    })
    return { period, byCurrency }
  }

  /** Mora por inquilino: una fila por id pedido, aunque no tenga cuotas. */
  arrears(
    renterIds: string[],
    unpaid: Installment[],
    today: IsoDate = todayIso(),
  ): RenterArrearsView[] {
    return renterIds.map((renterId) => {
      const rows = unpaid
        .filter((i) => i.renterId === renterId)
        .map((installment) => ({
          installment,
          balances: InstallmentPolicy.balances(installment, today),
        }))
        .filter((r) => Number(r.balances.totalDue) > 0)
      const overdue = rows.filter(
        (r) =>
          InstallmentPolicy.displayStatus(r.installment, r.balances, today) ===
          InstallmentStatus.OVERDUE,
      )
      return {
        renterId,
        status:
          overdue.length > 0
            ? ArrearsStatus.OVERDUE
            : rows.length > 0
              ? ArrearsStatus.PENDING
              : ArrearsStatus.UP_TO_DATE,
        overdueInstallments: overdue.length,
        maxDaysOverdue: overdue.reduce(
          (max, r) =>
            Math.max(max, InstallmentPolicy.daysOverdue(r.installment, today)),
          0,
        ),
        lateFeeAccrued: sumByCurrency(
          rows.map((r) => ({
            currency: r.installment.currency,
            amount: r.balances.lateFeeBalance,
          })),
        ),
        balance: sumByCurrency(
          rows.map((r) => ({
            currency: r.installment.currency,
            amount: r.balances.totalDue,
          })),
        ),
      }
    })
  }

  credits(renterId: string, credits: RenterCredit[]): RenterCreditsView {
    return {
      renterId,
      totals: sumByCurrency(
        credits
          .filter((c) => c.status === CreditStatus.AVAILABLE)
          .map((c) => ({ currency: c.currency, amount: c.remaining })),
      ).map(({ currency, amount }) => ({ currency, available: amount })),
      credits: credits.map(toCreditView),
    }
  }

  /** Pagos del listado general, con inquilino, propiedad y moneda del contrato. */
  async paymentList(
    payments: Payment[],
    installments: Installment[],
  ): Promise<PaymentListItemView[]> {
    if (payments.length === 0) return []
    const byId = new Map(installments.map((i) => [i.id, i]))
    const [parties, users] = await Promise.all([
      this.describeParties(installments),
      this.users.describe(
        payments.flatMap((p) =>
          [p.registeredById, p.confirmedById, p.voidedById].filter(
            (id): id is string => id !== null,
          ),
        ),
      ),
    ])
    return payments.map((payment) => {
      const installment = byId.get(payment.installmentId)
      return {
        ...toPaymentView(payment, installment?.period ?? '', users),
        renter: parties.renters.get(payment.renterId) ?? null,
        property: installment
          ? (parties.properties.get(installment.propertyId) ?? null)
          : null,
        currency: installment?.currency ?? payment.paidCurrency,
      }
    })
  }
}
