import { Injectable } from '@nestjs/common'

import { BillingFacade, PaymentVoidedPayload } from '@/modules/billing/public'
import { createLogger } from '@/shared/logging/root-logger'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  FeeMode,
  isConfirmed,
  Settlement,
  SettlementAdjustmentConcept,
  SettlementStatus,
} from '../domain/settlement'
import {
  FeeReceivableRepository,
  SettlementRepository,
} from '../domain/settlement.ports'
import { FeeReceivableStatus } from '../domain/settlement'
import { compareMoney } from '@/shared/money'
import { FeePolicy } from '../domain/fee.policy'
import { SettlementPolicy } from '../domain/settlement.policy'
import { SettlementDrafts } from './settlement-drafts'
import { SettlementReferences } from './settlement-references'

/**
 * Reacción a `payment-voided` (4.6, A-19). Si el pago estaba en una
 * liquidación pendiente, se recalcula (el pago ya no es liquidable). Si
 * estaba en una confirmada o transferida, esa no se toca: queda marcada y la
 * diferencia se descuenta con un ajuste automático en la próxima pendiente
 * del contrato (se crea vacía si no existe). Idempotente por pago.
 */
@Injectable()
export class VoidedPaymentReaction {
  private readonly logger = createLogger('VoidedPaymentReaction')

  constructor(
    private readonly settlements: SettlementRepository,
    private readonly receivables: FeeReceivableRepository,
    private readonly drafts: SettlementDrafts,
    private readonly prisma: PrismaService,
    private readonly billing: BillingFacade,
    private readonly references: SettlementReferences,
  ) {}

  async handle(payload: PaymentVoidedPayload): Promise<void> {
    await this.voidReceivable(payload)
    const settlement = await this.locate(payload)
    if (!settlement) return
    if (settlement.status === SettlementStatus.PENDING) {
      await this.prisma.transaction(() => this.drafts.recalculate(settlement))
      return
    }
    if (!isConfirmed(settlement)) return

    await this.deductInNextDraft(settlement, payload)
  }

  /**
   * La liquidación donde está el pago. `payload.settlementId` sólo viene
   * cuando ya se confirmó: una pendiente no marca sus pagos, así que antes
   * esta reacción salía sin recalcularla y al confirmarla se le pagaba al
   * propietario el pago anulado (crítico 1 / C1). Se busca por la línea y, si
   * no está en ninguna, por la pendiente del contrato (por si el pago llegó a
   * entrar en un cálculo que todavía no se guardó).
   */
  private async locate(
    payload: PaymentVoidedPayload,
  ): Promise<Settlement | null> {
    if (payload.settlementId) {
      const settlement = await this.settlements.findById(payload.settlementId)
      if (!settlement) {
        this.logger.warn(
          { settlementId: payload.settlementId, paymentId: payload.paymentId },
          'Se anuló un pago de una liquidación que no existe',
        )
      }
      return settlement
    }
    return (
      (await this.settlements.findContainingPayment(payload.paymentId)) ??
      (await this.settlements.findPendingByContract(payload.contractId))
    )
  }

  /**
   * El honorario devengado por un pago cobrado por el propietario (4.8): se
   * anula si no tiene cobros; si los tiene, queda marcado para revisión.
   */
  private async voidReceivable(payload: PaymentVoidedPayload): Promise<void> {
    const receivable = await this.receivables.findByOriginPayment(
      payload.paymentId,
    )
    if (!receivable || receivable.status === FeeReceivableStatus.VOIDED) return
    if (compareMoney(receivable.paidAmount, '0') > 0) {
      this.logger.warn(
        { receivableId: receivable.id, paymentId: payload.paymentId },
        'Se anuló un pago cuyo honorario ya tiene cobros: queda para revisión manual',
      )
      await this.receivables.update(receivable.id, { needsReview: true })
      return
    }
    await this.receivables.update(receivable.id, {
      status: FeeReceivableStatus.VOIDED,
      voidedAt: new Date(),
    })
  }

  private async deductInNextDraft(
    settlement: Settlement,
    payload: PaymentVoidedPayload,
  ): Promise<void> {
    const line = settlement.payments.find(
      (p) => p.paymentId === payload.paymentId,
    )
    const gross = SettlementPolicy.voidedPaymentAmount({
      rentApplied: line?.rentApplied ?? payload.rentApplied,
      lateFeeApplied: line?.lateFeeApplied ?? payload.lateFeeApplied,
      ownerChargesApplied: line?.ownerChargesApplied ?? payload.chargesApplied,
    })
    // El honorario que esta liquidación cobró por el pago anulado (D-259):
    // antes se descontaba el bruto y la inmobiliaria se quedaba con él.
    const fee = line ? await this.feeOfLine(settlement, line.paymentId) : '0.00'
    const amount = SettlementPolicy.voidedPaymentDeduction(
      gross,
      fee,
      settlement.feeDeducted,
    )
    await this.prisma.transaction(async () => {
      if (!settlement.hasVoidedPayments) {
        await this.settlements.update(settlement.id, {
          hasVoidedPayments: true,
        })
      }
      const draft = await this.drafts.draftForAdjustment(settlement.contractId)
      if (!draft) return
      if (
        draft.adjustments.some((a) => a.originPaymentId === payload.paymentId)
      ) {
        return
      }
      if (compareMoney(amount, '0') > 0) {
        await this.settlements.addAdjustment(draft.id, {
          concept: SettlementAdjustmentConcept.OTHER_DEDUCTION,
          description: SettlementPolicy.voidedPaymentDescription({
            paidAt: payload.paidAt,
            period: payload.period,
            reason: payload.voidReason,
          }),
          amount,
          originPaymentId: payload.paymentId,
          createdById: null,
        })
      }
      if (!settlement.feeDeducted) {
        await this.reduceSettlementReceivable(settlement.id, fee)
      }
      const refreshed = await this.settlements.findById(draft.id)
      if (!refreshed) return
      const adjustmentsTotal = SettlementPolicy.adjustmentsTotal(
        refreshed.adjustments,
      )
      await this.settlements.update(draft.id, {
        adjustmentsTotal,
        netAmount: SettlementPolicy.net(refreshed, adjustmentsTotal),
      })
    })
  }

  /** Honorario atribuible a la línea anulada, con los términos de su cuota. */
  private async feeOfLine(
    settlement: Settlement,
    paymentId: string,
  ): Promise<string> {
    const line = settlement.payments.find((p) => p.paymentId === paymentId)
    if (!line) return '0.00'
    const terms = (
      await this.billing.feeTermsForInstallments([line.installmentId])
    ).get(line.installmentId)
    if (!terms) return '0.00'
    const rules = await this.references.feeRules(settlement.ownerId)
    return SettlementPolicy.voidedPaymentFee(
      {
        feeMode: FeeMode[terms.feeMode],
        feePercentage: terms.feePercentage,
        feeAmount: terms.feeAmount,
        baseAmount: terms.baseAmount,
      },
      settlement.payments.filter((p) => p.installmentId === line.installmentId),
      paymentId,
      rules,
    )
  }

  /**
   * Sin descuento, el honorario nació como receivable al confirmar: baja en
   * lo que aportaba el pago anulado (D-259), o queda para revisión si ya se
   * cobró más de lo que quedaría.
   */
  private async reduceSettlementReceivable(
    settlementId: string,
    fee: string,
  ): Promise<void> {
    const receivable =
      await this.receivables.findByOriginSettlement(settlementId)
    if (!receivable) return
    const outcome = FeePolicy.reduceReceivable(receivable, fee)
    if (outcome.kind === 'none') return
    if (outcome.kind === 'review') {
      this.logger.warn(
        { receivableId: receivable.id, settlementId },
        'Se anuló un pago liquidado cuyo honorario ya se cobró: queda para revisión manual',
      )
      await this.receivables.update(receivable.id, { needsReview: true })
      return
    }
    if (outcome.kind === 'void') {
      await this.receivables.update(receivable.id, {
        status: FeeReceivableStatus.VOIDED,
        voidedAt: new Date(),
      })
      return
    }
    await this.receivables.update(receivable.id, {
      amount: outcome.amount,
      status: outcome.status,
    })
  }
}
