import { Injectable } from '@nestjs/common'

import { PaymentVoidedPayload } from '@/modules/billing/public'
import { createLogger } from '@/shared/logging/root-logger'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  isConfirmed,
  SettlementAdjustmentConcept,
  SettlementStatus,
} from '../domain/settlement'
import { SettlementRepository } from '../domain/settlement.ports'
import { SettlementPolicy } from '../domain/settlement.policy'
import { SettlementDrafts } from './settlement-drafts'

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
    private readonly drafts: SettlementDrafts,
    private readonly prisma: PrismaService,
  ) {}

  async handle(payload: PaymentVoidedPayload): Promise<void> {
    if (!payload.settlementId) return
    const settlement = await this.settlements.findById(payload.settlementId)
    if (!settlement) {
      this.logger.warn(
        { settlementId: payload.settlementId, paymentId: payload.paymentId },
        'Se anuló un pago de una liquidación que no existe',
      )
      return
    }
    if (settlement.status === SettlementStatus.PENDING) {
      await this.prisma.transaction(() => this.drafts.recalculate(settlement))
      return
    }
    if (!isConfirmed(settlement)) return

    const line = settlement.payments.find(
      (p) => p.paymentId === payload.paymentId,
    )
    const amount = SettlementPolicy.voidedPaymentAmount({
      rentApplied: line?.rentApplied ?? payload.rentApplied,
      lateFeeApplied: line?.lateFeeApplied ?? payload.lateFeeApplied,
      ownerChargesApplied: line?.ownerChargesApplied ?? payload.chargesApplied,
    })
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
}
