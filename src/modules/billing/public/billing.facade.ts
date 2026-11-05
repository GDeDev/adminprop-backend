import { Injectable } from '@nestjs/common'

import {
  compareMoney,
  isPositiveMoney,
  Money,
  subtractMoney,
  sumMoney,
  toMoneyString,
} from '@/shared/money'
import { IsoDate, Period, todayIso } from '@/shared/dates/calendar-date'
import {
  GenerationResult,
  InstallmentGenerator,
} from '../application/installment-generator'
import {
  InstallmentRebaser,
  RebaseResult,
} from '../application/installment-rebaser'
import {
  PaymentReceipts,
  PaymentReceiptData,
} from '../application/payment-receipts'
import {
  InstallmentDetailView,
  InstallmentSummaryView,
  InstallmentViews,
  MoneyByCurrency,
  RenterArrearsView,
  sumByCurrency,
} from '../application/installment.views'
import {
  activePayments,
  CollectionMode,
  CreditStatus,
  Currency,
  FeeMode,
  Installment,
  InstallmentStatus,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
} from '../domain/billing'
import {
  InstallmentRepository,
  PaymentRepository,
  RenterCreditRepository,
} from '../domain/billing.ports'
import {
  ChargesByConcept,
  InstallmentPolicy,
} from '../domain/installment.policy'

const ZERO = toMoneyString('0')

/** Una cuota vencida, para los recordatorios de la Fase 13. */
export interface OverdueInstallmentRef {
  id: string
  contractId: string
  renterId: string
  propertyId: string
  ownerId: string
  period: Period
  currency: Currency
  daysOverdue: number
  totalDue: string
  lateFeeBalance: string
  /** Alquiler que sigue sin cobrarse (sin cargos ni punitorio). */
  rentBalance: string
}

/** Una cuota del mes con alquiler por cobrar, para los avisos de la Fase 13. */
export interface RentDueRef {
  id: string
  contractId: string
  renterId: string
  ownerId: string
  propertyId: string
  period: Period
  currency: Currency
  baseAmount: string
  graceEndDate: IsoDate
  rentBalance: string
}

/** Lo cobrado de una cuota, para la liquidación (Fase 12). */
export interface InstallmentCollection {
  installmentId: string
  contractId: string
  ownerId: string
  period: Period
  currency: Currency
  baseAmount: string
  /** Alquiler cobrado por pagos confirmados, según quién lo recibió. */
  rentCollectedByAgency: string
  rentCollectedByOwner: string
  /** Alquiler cubierto con saldos a favor aplicados. */
  rentCollectedByCredit: string
  lateFeeCollected: string
  chargesCollected: string
  feeOnBase: string
  feeOnCollected: string
  feeMode: FeeMode
  collectionMode: CollectionMode
}

/** Los términos de honorarios de una cuota, tal como se congelaron (D-71). */
export interface InstallmentFeeTerms {
  installmentId: string
  period: Period
  currency: Currency
  baseAmount: string
  feeMode: FeeMode
  feePercentage: string
  feeAmount: string | null
}

/** Una cuota con sus importes del período, para los reportes de la Fase 19. */
export interface ReportInstallmentRef {
  id: string
  contractId: string
  renterId: string
  ownerId: string
  propertyId: string
  period: Period
  currency: Currency
  baseAmount: string
  graceEndDate: IsoDate
  /** Estado que ve el usuario (vencida si pasó la gracia con saldo). */
  status: InstallmentStatus
  daysOverdue: number
  /** Lo imputado por los pagos vigentes (un pago sin confirmar ya cuenta, D-76). */
  paidTotal: string
  rentPaid: string
  rentBalance: string
  /** Saldo total a esa fecha: alquiler + cargos + punitorio. */
  totalDue: string
  /** Punitorio devengado, ya sin lo reducido ni lo condonado. */
  lateFeeAccrued: string
  lateFeePaid: string
  lateFeeBalance: string
  /** Honorarios devengados sobre lo cobrado (regla 9). */
  feeOnCollected: string
}

/** Alquiler devengado y cobrado de un mes y una moneda, ya sumado. */
export interface ReportRentTotalRef {
  period: Period
  currency: Currency
  baseAmount: string
  rentPaid: string
}

/** Un pago confirmado con los datos de su cuota, para los reportes. */
export interface ReportPaymentRef {
  paymentId: string
  installmentId: string
  paidAt: IsoDate
  period: Period
  renterId: string
  ownerId: string
  propertyId: string
  /** Moneda de la cuota (en la que se imputa). */
  currency: Currency
  paidCurrency: Currency
  /** Lo entregado, en `paidCurrency`. */
  amount: string
  rentApplied: string
  lateFeeApplied: string
  chargesApplied: string
  kind: PaymentKind
  method: PaymentMethod
  receivedBy: PaymentReceiver
}

/**
 * Un pago que una liquidación puede incluir (Fase 12, 2.2): confirmado,
 * recibido por la inmobiliaria (plata o saldo a favor aplicado) y todavía
 * sin liquidación. Lo imputado a cargos viene abierto por concepto (A-16).
 */
export interface SettleablePayment {
  paymentId: string
  installmentId: string
  paidAt: IsoDate
  rentApplied: string
  lateFeeApplied: string
  chargesApplied: ChargesByConcept
  currency: Currency
  installment: InstallmentFeeTerms
}

/**
 * Lo que otros módulos pueden pedirle a cobros. Dentro del tenant del
 * contexto; el cron de la Fase 13 entra por inmobiliaria con
 * `RequestContext.runInTenant`.
 */
@Injectable()
export class BillingFacade {
  constructor(
    private readonly generator: InstallmentGenerator,
    private readonly installments: InstallmentRepository,
    private readonly payments: PaymentRepository,
    private readonly views: InstallmentViews,
    private readonly rebaser: InstallmentRebaser,
    private readonly receipts: PaymentReceipts,
    private readonly credits: RenterCreditRepository,
  ) {}

  // ------------------------------------------------------------- Portales
  // Fases 17 y 18. Cada método recibe el id de la persona del portal y
  // responde null (o vacío) si lo pedido no es suyo: el portal lo traduce a 404.

  /** Historial de cuotas de un inquilino, las más nuevas primero. */
  async pageInstallmentsOfRenter(
    renterId: string,
    page: { skip: number; take: number },
  ): Promise<[InstallmentSummaryView[], number]> {
    const [rows, total] = await this.installments.list({ renterId }, page)
    return [await this.views.summaries(rows), total]
  }

  /** La ficha de una cuota del inquilino, o null si no es suya. */
  async installmentOfRenter(
    renterId: string,
    id: string,
  ): Promise<InstallmentDetailView | null> {
    const installment = await this.installments.findById(id)
    return installment && installment.renterId === renterId
      ? this.views.detail(installment)
      : null
  }

  /**
   * La cuota del mes de un contrato del inquilino; si ese mes no tiene (un
   * contrato finalizado, A-35), la más reciente.
   */
  async currentInstallmentOfRenter(
    renterId: string,
    contractId: string,
    period: Period,
  ): Promise<InstallmentDetailView | null> {
    const own = await this.installments.listAll({ renterId, contractId })
    const installment = own.find((i) => i.period === period) ?? own[0]
    return installment ? this.views.detail(installment) : null
  }

  /** Saldo a favor disponible del inquilino, por moneda. */
  async creditsAvailableOfRenter(renterId: string): Promise<MoneyByCurrency[]> {
    const credits = await this.credits.listByRenter(renterId)
    return sumByCurrency(
      credits
        .filter((c) => c.status === CreditStatus.AVAILABLE)
        .map((c) => ({ currency: c.currency, amount: c.remaining })),
    )
  }

  /**
   * El recibo PDF de un pago del inquilino: `null` si el pago no es suyo,
   * `{ url: null }` si todavía no se generó.
   */
  async receiptOfRenter(
    renterId: string,
    paymentId: string,
  ): Promise<{ url: string | null } | null> {
    const payment = await this.payments.findById(paymentId)
    return payment && payment.renterId === renterId
      ? { url: payment.receiptPdfUrl }
      : null
  }

  /** Cuotas de una propiedad del propietario, las más nuevas primero. */
  async pageInstallmentsOfProperty(
    ownerId: string,
    propertyId: string,
    page: { skip: number; take: number },
  ): Promise<[InstallmentSummaryView[], number]> {
    const [rows, total] = await this.installments.list(
      { ownerId, propertyId },
      page,
    )
    return [await this.views.summaries(rows), total]
  }

  /** Todas las cuotas de un mes de las propiedades del propietario. */
  async installmentsOfOwnerForPeriod(
    ownerId: string,
    period: Period,
  ): Promise<InstallmentSummaryView[]> {
    return this.views.summaries(
      await this.installments.listAll({ ownerId, period }),
    )
  }

  /**
   * Todo lo que lleva el recibo de un pago (Fase 15). Si el pago es un cobro
   * en efectivo o transferencia y todavía no tiene número, le reserva el
   * próximo del tenant (A-33); si ya tiene, devuelve el mismo. Null si el
   * pago no existe.
   */
  async paymentForReceipt(
    paymentId: string,
  ): Promise<PaymentReceiptData | null> {
    const data = await this.receipts.dataFor(paymentId)
    if (!data) return null
    if (data.receiptNumber === null && this.receipts.isReceiptable(data)) {
      data.receiptNumber = await this.receipts.ensureNumber(paymentId)
    }
    return data
  }

  /** Guarda el PDF vigente del recibo en el pago (Fase 15). */
  attachReceipt(
    paymentId: string,
    file: { key: string; url: string },
  ): Promise<void> {
    return this.payments.attachReceiptPdf(paymentId, file)
  }

  /** El dueño del pago, para autorizar la descarga del recibo (Fase 15). */
  async receiptOwner(
    paymentId: string,
  ): Promise<{ renterId: string; ownerId: string } | null> {
    const payment = await this.payments.findById(paymentId)
    if (!payment) return null
    const installment = await this.installments.findById(payment.installmentId)
    if (!installment) return null
    return { renterId: payment.renterId, ownerId: installment.ownerId }
  }

  /**
   * Los pagos liquidables de un contrato (Fase 12, 4.1), más viejos primero,
   * con la cuota a la que pertenecen y sus términos de honorarios.
   */
  async listSettleablePayments(
    contractId: string,
  ): Promise<SettleablePayment[]> {
    const payments = await this.payments.listSettleable(contractId)
    if (payments.length === 0) return []
    const installments = await this.installments.listAll({
      ids: [...new Set(payments.map((p) => p.installmentId))],
    })
    const byId = new Map(installments.map((i) => [i.id, i]))
    return payments.flatMap((payment) => {
      const installment = byId.get(payment.installmentId)
      if (!installment) return []
      const charges = InstallmentPolicy.chargesAppliedByConcept(
        installment,
      ).get(payment.id) ?? {
        SERVICE: '0.00',
        TERMINATION_PENALTY: '0.00',
        OTHER: '0.00',
      }
      return [
        {
          paymentId: payment.id,
          installmentId: installment.id,
          paidAt: payment.paidAt,
          rentApplied: payment.rentApplied,
          lateFeeApplied: payment.lateFeeApplied,
          chargesApplied: charges,
          currency: installment.currency,
          installment: toFeeTerms(installment),
        },
      ]
    })
  }

  /** La liquidación marca los pagos que incluyó; sólo toca los libres. Devuelve cuántos. */
  markPaymentsSettled(ids: string[], settlementId: string): Promise<number> {
    return this.payments.markSettled(ids, settlementId)
  }

  /** Libera los pagos de una liquidación cancelada o recalculada. */
  unmarkPaymentsSettled(settlementId: string): Promise<number> {
    return this.payments.unmarkSettled(settlementId)
  }

  /** Términos de honorarios congelados en cada cuota (Fase 12, 4.2). */
  async feeTermsForInstallments(
    ids: string[],
  ): Promise<Map<string, InstallmentFeeTerms>> {
    if (ids.length === 0) return new Map()
    const installments = await this.installments.listAll({
      ids: [...new Set(ids)],
    })
    return new Map(installments.map((i) => [i.id, toFeeTerms(i)]))
  }

  /** Las cuotas de un mes (sin período, el siguiente). Idempotente. */
  generateInstallments(period?: Period): Promise<GenerationResult> {
    return this.generator.generate(period ?? null)
  }

  /**
   * Corrige la base de las cuotas ya generadas de un contrato tras un
   * aumento (Fase 13, 2.1): las pendientes sin pagos pasan al alquiler
   * que les corresponde según el historial del contrato, las demás se devuelven en `outdated` para avisar.
   */
  rebaseInstallments(
    contractId: string,
    effectiveFrom: IsoDate,
  ): Promise<RebaseResult> {
    return this.rebaser.rebase(contractId, effectiveFrom)
  }

  /**
   * Las cuotas del mes que siguen `PENDING` y sin ningún pago vigente: a
   * quienes se les manda el recordatorio de pago (A-26).
   */
  async listPendingForReminder(period: Period): Promise<RentDueRef[]> {
    const installments = await this.installments.listAll({ period })
    return installments
      .filter(
        (i) =>
          i.status === InstallmentStatus.PENDING &&
          activePayments(i).length === 0,
      )
      .map((i) => toRentDue(i, i.baseAmount))
  }

  /**
   * Las cuotas del mes con saldo de alquiler a esa fecha (alerta a la
   * aseguradora, A-27). Un pago sin confirmar ya cuenta como cobrado.
   */
  async listWithRentDue(
    period: Period,
    today: IsoDate = todayIso(),
  ): Promise<RentDueRef[]> {
    const installments = await this.installments.listAll({
      period,
      unpaid: true,
    })
    return installments.flatMap((i) => {
      const { rentBalance } = InstallmentPolicy.balances(i, today)
      return isPositiveMoney(rentBalance) ? [toRentDue(i, rentBalance)] : []
    })
  }

  /** Las cuotas con saldo y gracia vencida a esa fecha, las más atrasadas primero. */
  async listOverdue(
    today: IsoDate = todayIso(),
  ): Promise<OverdueInstallmentRef[]> {
    const unpaid = await this.installments.listAll({
      unpaidGraceEndBefore: today,
    })
    return unpaid
      .map((installment) => ({
        installment,
        balances: InstallmentPolicy.balances(installment, today),
      }))
      .filter((r) => isPositiveMoney(r.balances.totalDue))
      .map(({ installment, balances }) => ({
        id: installment.id,
        contractId: installment.contractId,
        renterId: installment.renterId,
        propertyId: installment.propertyId,
        ownerId: installment.ownerId,
        period: installment.period,
        currency: installment.currency,
        daysOverdue: InstallmentPolicy.daysOverdue(installment, today),
        totalDue: balances.totalDue,
        lateFeeBalance: balances.lateFeeBalance,
        rentBalance: balances.rentBalance,
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
  }

  /** Lo cobrado (confirmado) de cada cuota, para liquidar (Micaela #5, #9, #10). */
  async collectionsByInstallment(
    ids: string[],
  ): Promise<Map<string, InstallmentCollection>> {
    if (ids.length === 0) return new Map()
    const installments = await this.installments.listAll({ ids })
    return new Map(
      installments.map((installment) => {
        const confirmed = installment.payments.filter(
          (p) => p.status === PaymentStatus.CONFIRMED,
        )
        const rentBy = (receiver: PaymentReceiver) =>
          sumMoney(
            confirmed
              .filter(
                (p) =>
                  p.kind === PaymentKind.CASH_IN && p.receivedBy === receiver,
              )
              .map((p) => p.rentApplied),
          )
        const fees = InstallmentPolicy.feeAccrual(installment)
        return [
          installment.id,
          {
            installmentId: installment.id,
            contractId: installment.contractId,
            ownerId: installment.ownerId,
            period: installment.period,
            currency: installment.currency,
            baseAmount: installment.baseAmount,
            rentCollectedByAgency: rentBy(PaymentReceiver.AGENCY),
            rentCollectedByOwner: rentBy(PaymentReceiver.OWNER),
            rentCollectedByCredit: sumMoney(
              confirmed
                .filter((p) => p.kind === PaymentKind.CREDIT_APPLICATION)
                .map((p) => p.rentApplied),
            ),
            lateFeeCollected: sumMoney(confirmed.map((p) => p.lateFeeApplied)),
            chargesCollected: sumMoney(confirmed.map((p) => p.chargesApplied)),
            feeOnBase: fees.feeOnBase,
            feeOnCollected: fees.feeOnCollected,
            feeMode: installment.feeMode,
            collectionMode: installment.collectionMode,
          },
        ]
      }),
    )
  }

  /** Mora por inquilino (portal, Fase 18; listados). */
  async arrearsByRenter(
    renterIds: string[],
    today: IsoDate = todayIso(),
  ): Promise<RenterArrearsView[]> {
    const ids = [...new Set(renterIds)]
    if (ids.length === 0) return []
    const unpaid = await this.installments.listAll({
      renterIds: ids,
      unpaid: true,
    })
    return this.views.arrears(ids, unpaid, today)
  }

  /**
   * Las cuotas de un rango de períodos con sus importes a esa fecha (reportes
   * de la Fase 19). Filtra además por propietario, propiedad o inquilino.
   */
  async reportInstallments(
    filter: {
      period?: Period
      periodFrom?: Period
      periodTo?: Period
      ownerId?: string
      propertyId?: string
      renterId?: string
      /** Sólo las no saldadas. */
      unpaid?: boolean
    },
    today: IsoDate = todayIso(),
  ): Promise<ReportInstallmentRef[]> {
    const installments = await this.installments.listAll(filter)
    return installments.map((installment) => {
      const balances = InstallmentPolicy.balances(installment, today)
      const lateFeeNet = installment.lateFeeWaived
        ? ZERO
        : nonNegativeMoney(
            subtractMoney(balances.lateFeeAccrued, balances.lateFeeAdjusted),
          )
      return {
        id: installment.id,
        contractId: installment.contractId,
        renterId: installment.renterId,
        ownerId: installment.ownerId,
        propertyId: installment.propertyId,
        period: installment.period,
        currency: installment.currency,
        baseAmount: installment.baseAmount,
        graceEndDate: installment.graceEndDate,
        status: InstallmentPolicy.displayStatus(installment, balances, today),
        daysOverdue: InstallmentPolicy.daysOverdue(installment, today),
        paidTotal: balances.paidTotal,
        rentPaid: balances.rentPaid,
        rentBalance: balances.rentBalance,
        totalDue: balances.totalDue,
        lateFeeAccrued: lateFeeNet,
        lateFeePaid: balances.lateFeePaid,
        lateFeeBalance: balances.lateFeeBalance,
        feeOnCollected:
          InstallmentPolicy.feeAccrual(installment).feeOnCollected,
      }
    })
  }

  /**
   * Alquiler devengado y cobrado por mes y moneda en un rango de períodos
   * (historial del dashboard). Se suma en la base: no hidrata las cuotas.
   */
  async reportRentTotals(
    periodFrom: Period,
    periodTo: Period,
  ): Promise<ReportRentTotalRef[]> {
    return this.installments.rentTotalsByPeriod(periodFrom, periodTo)
  }

  /**
   * Los pagos confirmados con `paidAt` en el rango (inclusive), con los datos
   * de su cuota. Filtra por propietario, propiedad o inquilino. Los anulados
   * y los que esperan confirmación no figuran.
   */
  async reportPayments(filter: {
    from?: IsoDate
    to?: IsoDate
    ownerId?: string
    propertyId?: string
    renterId?: string
  }): Promise<ReportPaymentRef[]> {
    const payments = await this.payments.listAll({
      status: PaymentStatus.CONFIRMED,
      from: filter.from,
      to: filter.to,
      renterId: filter.renterId,
    })
    if (payments.length === 0) return []
    const installments = new Map(
      (
        await this.installments.listAll({
          ids: [...new Set(payments.map((p) => p.installmentId))],
        })
      ).map((installment) => [installment.id, installment]),
    )
    return payments.flatMap((payment) => {
      const installment = installments.get(payment.installmentId)
      if (
        !installment ||
        (filter.ownerId && installment.ownerId !== filter.ownerId) ||
        (filter.propertyId && installment.propertyId !== filter.propertyId)
      ) {
        return []
      }
      return [
        {
          paymentId: payment.id,
          installmentId: installment.id,
          paidAt: payment.paidAt,
          period: installment.period,
          renterId: installment.renterId,
          ownerId: installment.ownerId,
          propertyId: installment.propertyId,
          currency: installment.currency,
          paidCurrency: payment.paidCurrency,
          amount: payment.amount,
          rentApplied: payment.rentApplied,
          lateFeeApplied: payment.lateFeeApplied,
          chargesApplied: payment.chargesApplied,
          kind: payment.kind,
          method: payment.method,
          receivedBy: payment.receivedBy,
        },
      ]
    })
  }

  /** Pagos informados que esperan confirmación (dashboard de la Fase 19). */
  async countPaymentsToConfirm(): Promise<number> {
    return this.payments.count({ status: PaymentStatus.PENDING_CONFIRMATION })
  }
}

function nonNegativeMoney(value: Money): string {
  return compareMoney(value, ZERO) < 0 ? ZERO : toMoneyString(value)
}

function toRentDue(installment: Installment, rentBalance: string): RentDueRef {
  return {
    id: installment.id,
    contractId: installment.contractId,
    renterId: installment.renterId,
    ownerId: installment.ownerId,
    propertyId: installment.propertyId,
    period: installment.period,
    currency: installment.currency,
    baseAmount: installment.baseAmount,
    graceEndDate: installment.graceEndDate,
    rentBalance,
  }
}

function toFeeTerms(installment: {
  id: string
  period: Period
  currency: Currency
  baseAmount: string
  feeMode: FeeMode
  feePercentage: string
  feeAmount: string | null
}): InstallmentFeeTerms {
  return {
    installmentId: installment.id,
    period: installment.period,
    currency: installment.currency,
    baseAmount: installment.baseAmount,
    feeMode: installment.feeMode,
    feePercentage: installment.feePercentage,
    feeAmount: installment.feeAmount,
  }
}
