import { Injectable } from '@nestjs/common'

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
  InstallmentViews,
  RenterArrearsView,
  sumMoney,
} from '../application/installment.views'
import {
  activePayments,
  CollectionMode,
  Currency,
  FeeMode,
  Installment,
  InstallmentStatus,
  PaymentKind,
  PaymentReceiver,
  PaymentStatus,
} from '../domain/billing'
import {
  InstallmentRepository,
  PaymentRepository,
} from '../domain/billing.ports'
import {
  ChargesByConcept,
  InstallmentPolicy,
} from '../domain/installment.policy'

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
  ) {}

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
      return Number(rentBalance) > 0 ? [toRentDue(i, rentBalance)] : []
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
      .filter((r) => Number(r.balances.totalDue) > 0)
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
