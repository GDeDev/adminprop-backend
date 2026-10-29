import { Injectable } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'

import { todayIso } from '@/shared/dates/calendar-date'
import { Installment, InstallmentStatus } from '../domain/billing'
import { InstallmentRepository } from '../domain/billing.ports'
import { InstallmentPolicy } from '../domain/installment.policy'
import { InstallmentPaidEvent } from './events/installment-paid.event'

/**
 * Después de cada movimiento (pago, anulación, cargo, ajuste) se recalcula
 * lo que la cuota guarda (regla 6): el estado, el día en que se saldó el
 * alquiler y, cuando se salda, el detalle diario congelado (A-4). Al pasar
 * a PAID emite `InstallmentPaidEvent` (Fase 12).
 */
@Injectable()
export class InstallmentRecalculator {
  constructor(
    private readonly installments: InstallmentRepository,
    private readonly eventBus: EventBus,
  ) {}

  async recalculate(installmentId: string): Promise<Installment> {
    const loaded = await this.installments.findById(installmentId)
    if (!loaded) throw new Error(`La cuota ${installmentId} desapareció`)

    const paidAt = InstallmentPolicy.paidAtOf(loaded)
    const current: Installment = { ...loaded, paidAt }
    const balances = InstallmentPolicy.balances(current, todayIso())
    const status = InstallmentPolicy.storedStatus(current, balances)

    const updated = await this.installments.update(loaded.id, {
      status,
      paidAt,
    })
    if (paidAt !== loaded.paidAt) {
      // Saldado el alquiler, el punitorio deja de correr: se congela el
      // detalle. Si se reabrió (anulación), vuelve a calcularse en vivo.
      await this.installments.replaceFeeDays(
        loaded.id,
        paidAt ? InstallmentPolicy.lateFeeDays(current, paidAt) : [],
      )
    }
    if (
      status === InstallmentStatus.PAID &&
      loaded.status !== InstallmentStatus.PAID
    ) {
      this.eventBus.publish(
        new InstallmentPaidEvent(
          loaded.id,
          loaded.contractId,
          loaded.ownerId,
          loaded.period,
        ),
      )
    }
    return (await this.installments.findById(loaded.id)) ?? updated
  }
}
