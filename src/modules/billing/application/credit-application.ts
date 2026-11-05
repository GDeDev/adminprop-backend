import { EventBus } from '@nestjs/cqrs'

import {
  CreditStatus,
  Installment,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
} from '@/modules/billing/domain/billing'
import {
  PaymentRepository,
  RenterCreditRepository,
} from '@/modules/billing/domain/billing.ports'
import { InstallmentBalances } from '@/modules/billing/domain/installment.policy'
import {
  CreditApplicationPlan,
  PaymentPolicy,
} from '@/modules/billing/domain/payment.policy'
import { IsoDate } from '@/shared/dates/calendar-date'
import { compareMoney, subtractMoney, toMoneyString } from '@/shared/money'
import { PaymentConfirmedEvent } from './events/payment-events'

/**
 * Avisa a liquidaciones (Fase 12) de cada pago que quedó confirmado. Se
 * emite después de la transacción: si ella falla, no hay aviso que retirar.
 */
export function publishConfirmed(
  eventBus: EventBus,
  installment: Installment,
  payments: Payment[],
): void {
  for (const payment of payments) {
    if (payment.status !== PaymentStatus.CONFIRMED) continue
    eventBus.publish(
      new PaymentConfirmedEvent(
        payment,
        { ownerId: installment.ownerId, period: installment.period },
        installment.currency,
      ),
    )
  }
}

/**
 * Aplica saldos a favor a una cuota (regla 5): un pago `CREDIT_APPLICATION`
 * por cada crédito del plan, imputado con el orden por defecto sobre los
 * saldos que van quedando. Devuelve los pagos creados y los saldos finales.
 */
export async function applyCreditPlan(
  deps: {
    payments: PaymentRepository
    credits: RenterCreditRepository
  },
  installment: Installment,
  plan: CreditApplicationPlan[],
  balances: InstallmentBalances,
  paidAt: IsoDate,
  registeredById: string | null,
): Promise<{ created: Payment[]; balances: InstallmentBalances }> {
  const created: Payment[] = []
  let remaining = balances
  for (const { credit, amount } of plan) {
    const allocation = PaymentPolicy.allocate(amount, remaining, null)
    const payment = await deps.payments.create({
      installmentId: installment.id,
      contractId: installment.contractId,
      renterId: installment.renterId,
      paidAt,
      paidCurrency: installment.currency,
      amount,
      exchangeRate: null,
      exchangeRateSource: null,
      exchangeRateDate: null,
      amountInContractCurrency: amount,
      kind: PaymentKind.CREDIT_APPLICATION,
      method: PaymentMethod.CREDIT,
      receivedBy: PaymentReceiver.AGENCY,
      status: PaymentStatus.CONFIRMED,
      ...allocation,
      creditId: credit.id,
      receiptKey: null,
      receiptUrl: null,
      registeredById,
      notes: null,
    })
    const left = toMoneyString(subtractMoney(credit.remaining, amount))
    await deps.credits.update(credit.id, {
      remaining: left,
      status:
        compareMoney(left, '0') === 0
          ? CreditStatus.APPLIED
          : CreditStatus.AVAILABLE,
    })
    created.push(payment)
    remaining = PaymentPolicy.remainingAfter(remaining, allocation)
  }
  return { created, balances: remaining }
}
