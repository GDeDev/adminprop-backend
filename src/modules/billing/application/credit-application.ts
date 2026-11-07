import { EventBus } from '@nestjs/cqrs'

import { CreditNotAvailableException } from '@/modules/billing/domain/billing.exceptions'
import {
  Installment,
  Payment,
  PaymentKind,
  PaymentMethod,
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
      // Lo recibió quien tiene la plata del saldo: si es el propietario, la
      // aplicación no se liquida (devenga honorario como un cobro directo).
      // Antes siempre era AGENCY y la inmobiliaria transfería plata que nunca
      // recibió (crítico 3).
      receivedBy: credit.heldBy,
      status: PaymentStatus.CONFIRMED,
      ...allocation,
      creditId: credit.id,
      receiptKey: null,
      receiptUrl: null,
      registeredById,
      notes: null,
    })
    // Resta condicional y relativa: antes se escribía un `remaining`
    // absoluto calculado en memoria y dos aplicaciones a la vez del mismo
    // saldo lo gastaban dos veces (alto 4 / C2). Los llamadores ya tienen el
    // saldo bloqueado (`lockAvailable`); esto es la red por si no.
    const consumed = await deps.credits.consume(credit.id, amount)
    if (!consumed) {
      throw new CreditNotAvailableException(
        'otro movimiento usó el saldo a la vez; volvé a intentar',
      )
    }
    created.push(payment)
    remaining = PaymentPolicy.remainingAfter(remaining, allocation)
  }
  return { created, balances: remaining }
}
