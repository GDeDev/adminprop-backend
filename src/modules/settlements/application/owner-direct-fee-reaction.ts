import { Injectable } from '@nestjs/common'

import {
  BillingFacade,
  PaymentConfirmedPayload,
} from '@/modules/billing/public'
import { createLogger } from '@/shared/logging/root-logger'
import { compareMoney } from '@/shared/money'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { FeePolicy } from '../domain/fee.policy'
import { Currency, FeeMode, FeeReceivableSource } from '../domain/settlement'
import { FeeAccountService } from './fee-account.service'
import { SettlementReferences } from './settlement-references'

/**
 * Reacción a `payment-confirmed` (4.8, Micaela #9B): si el alquiler lo cobró
 * el propietario, la inmobiliaria devenga igual su honorario con los
 * términos congelados de la cuota y la base que el propietario configuró.
 * Idempotente por pago de origen.
 */
@Injectable()
export class OwnerDirectFeeReaction {
  private readonly logger = createLogger('OwnerDirectFeeReaction')

  constructor(
    private readonly billing: BillingFacade,
    private readonly references: SettlementReferences,
    private readonly fees: FeeAccountService,
    private readonly prisma: PrismaService,
  ) {}

  async handle(payload: PaymentConfirmedPayload): Promise<void> {
    if (payload.receivedBy !== 'OWNER') return
    if (compareMoney(payload.rentApplied, '0') <= 0) return
    const terms = (
      await this.billing.feeTermsForInstallments([payload.installmentId])
    ).get(payload.installmentId)
    if (!terms) {
      this.logger.warn(
        { installmentId: payload.installmentId },
        'Pago confirmado de una cuota que no existe: no se devenga honorario',
      )
      return
    }
    const rules = await this.references.feeRules(payload.ownerId)
    // El pago no abre sus cargos por concepto: los que cobró el propietario
    // se toman todos como cargos del propietario (los SERVICE los cobra la
    // inmobiliaria; si el propietario los recibió, son suyos igual).
    const fee = FeePolicy.feeForInstallment(
      {
        feeMode: FeeMode[terms.feeMode],
        feePercentage: terms.feePercentage,
        feeAmount: terms.feeAmount,
        baseAmount: terms.baseAmount,
      },
      {
        rentApplied: payload.rentApplied,
        lateFeeApplied: payload.lateFeeApplied,
        ownerChargesApplied: payload.chargesApplied,
      },
      rules,
    )
    await this.prisma.transaction(() =>
      this.fees.accrue({
        ownerId: payload.ownerId,
        contractId: payload.contractId,
        installmentId: payload.installmentId,
        period: payload.period,
        currency: Currency[payload.currency as keyof typeof Currency],
        source: FeeReceivableSource.OWNER_DIRECT_PAYMENT,
        payer: FeePolicy.payerFor(FeeMode[terms.feeMode]),
        originPaymentId: payload.paymentId,
        originSettlementId: null,
        amount: fee.amount,
        feePercentage: terms.feePercentage,
        feeAmountFixed: terms.feeAmount,
        baseAmount: fee.base,
      }),
    )
  }
}
