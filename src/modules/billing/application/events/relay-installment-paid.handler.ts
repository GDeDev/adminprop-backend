import { EventsHandler, IEventHandler } from '@nestjs/cqrs'

import {
  INSTALLMENT_PAID_QUEUE,
  InstallmentPaidPayload,
} from '@/modules/billing/public/billing-events'
import { QueuePort } from '@/platform/queue/queue.port'
import { createLogger } from '@/shared/logging/root-logger'
import { InstallmentPaidEvent } from './installment-paid.event'

/**
 * Pasa el evento del `EventBus` a la cola: el transporte entre módulos es
 * pg-boss, así el efecto sobrevive a un reinicio y se reintenta (igual que
 * `_example`). La Fase 12 lo escucha para generar la liquidación.
 */
@EventsHandler(InstallmentPaidEvent)
export class RelayInstallmentPaidHandler implements IEventHandler<InstallmentPaidEvent> {
  private readonly logger = createLogger('InstallmentPaidRelay')

  constructor(private readonly queue: QueuePort) {}

  async handle(event: InstallmentPaidEvent): Promise<void> {
    const payload: InstallmentPaidPayload = {
      installmentId: event.installmentId,
      contractId: event.contractId,
      ownerId: event.ownerId,
      period: event.period,
    }
    try {
      await this.queue.publish(INSTALLMENT_PAID_QUEUE, payload)
    } catch (error) {
      // El EventBus no espera a sus handlers: si no se loguea, nadie se
      // entera. La cuota ya está saldada; lo que se pierde es el aviso.
      this.logger.error(
        { err: error, installmentId: event.installmentId },
        'No se pudo publicar InstallmentPaid en la cola',
      )
    }
  }
}
