import { Injectable, OnModuleInit } from '@nestjs/common'

import {
  INSTALLMENT_PAID_QUEUE,
  InstallmentPaidPayload,
  PAYMENT_VOIDED_QUEUE,
  PaymentVoidedPayload,
} from '@/modules/billing/public'
import { SettlementDrafts } from '@/modules/settlements/application/settlement-drafts'
import { VoidedPaymentReaction } from '@/modules/settlements/application/voided-payment-reaction'
import { QueuePort } from '@/platform/queue/queue.port'
import { PrismaService } from '@/shared/prisma/prisma.service'

/**
 * Se suscribe a las colas de cobros (sección 6). El handler corre dentro
 * del tenant del mensaje; si falla, pg-boss reintenta y después lo manda a
 * la dead-letter, así una liquidación pendiente no se pierde por un corte.
 */
@Injectable()
export class BillingEventsConsumer implements OnModuleInit {
  constructor(
    private readonly queue: QueuePort,
    private readonly drafts: SettlementDrafts,
    private readonly voided: VoidedPaymentReaction,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.consume<InstallmentPaidPayload>(
      INSTALLMENT_PAID_QUEUE,
      async (message) => {
        await this.prisma.transaction(() =>
          this.drafts.ensureDraft(message.payload.contractId),
        )
      },
    )
    await this.queue.consume<PaymentVoidedPayload>(
      PAYMENT_VOIDED_QUEUE,
      (message) => this.voided.handle(message.payload),
    )
  }
}
