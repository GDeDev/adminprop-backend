import { Injectable } from '@nestjs/common'

import { createLogger } from '@/shared/logging/root-logger'
import { addMoney, compareMoney, toMoneyString } from '@/shared/money'
import { FeePolicy } from '../domain/fee.policy'
import { FeeReceivable } from '../domain/settlement'
import {
  FeePaymentRepository,
  FeeReceivableRepository,
  NewFeeReceivable,
} from '../domain/settlement.ports'

/**
 * Altas y cobros de la cuenta de honorarios (3.3, 4.8). Lo comparten la
 * confirmación de una liquidación que no descuenta, el listener de pagos
 * cobrados por el propietario y el registro de pagos de honorarios. Corre
 * dentro de la transacción de quien lo llama.
 */
@Injectable()
export class FeeAccountService {
  private readonly logger = createLogger('FeeAccountService')

  constructor(
    private readonly receivables: FeeReceivableRepository,
    private readonly payments: FeePaymentRepository,
  ) {}

  /**
   * Devenga un honorario. Idempotente por origen (pago o liquidación): el
   * reintento de un listener no duplica. Un monto en cero no genera nada.
   * Si el propietario tenía pagos con saldo sin imputar en esa moneda, se
   * aplican enseguida (3.3).
   */
  async accrue(data: NewFeeReceivable): Promise<FeeReceivable | null> {
    if (compareMoney(data.amount, '0') <= 0) return null
    const created = await this.receivables.createIfAbsent(data)
    if (!created) {
      this.logger.info(
        {
          originPaymentId: data.originPaymentId,
          originSettlementId: data.originSettlementId,
        },
        'El honorario ya estaba devengado: se ignora el duplicado',
      )
      return null
    }
    return this.applyUnallocated(created)
  }

  /** Imputa un monto a un receivable y recalcula su estado. */
  async applyToReceivable(
    receivable: FeeReceivable,
    amount: string,
  ): Promise<FeeReceivable> {
    const paidAmount = toMoneyString(addMoney(receivable.paidAmount, amount))
    return this.receivables.update(receivable.id, {
      paidAmount,
      status: FeePolicy.receivableStatus(receivable.amount, paidAmount),
    })
  }

  /**
   * Los pagos del propietario con saldo sin imputar, del más viejo al más
   * nuevo, cubren el receivable nuevo hasta donde alcancen.
   */
  private async applyUnallocated(
    receivable: FeeReceivable,
  ): Promise<FeeReceivable> {
    const pending = await this.payments.listAll(
      {
        ownerId: receivable.ownerId,
        currency: receivable.currency,
        withUnallocated: true,
      },
      'oldest',
    )
    let current = receivable
    for (const payment of pending) {
      const { allocations, unallocated } = FeePolicy.allocate(
        payment.unallocatedAmount,
        [current],
      )
      if (allocations.length === 0) break
      await this.payments.addAllocations(
        payment.id,
        allocations.map((a) => ({
          feeReceivableId: a.receivableId,
          amount: a.amount,
        })),
      )
      await this.payments.update(payment.id, { unallocatedAmount: unallocated })
      current = await this.applyToReceivable(current, allocations[0].amount)
      if (compareMoney(FeePolicy.remainingOf(current), '0') <= 0) break
    }
    return current
  }
}
