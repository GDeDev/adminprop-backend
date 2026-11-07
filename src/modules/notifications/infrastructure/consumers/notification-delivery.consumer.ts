import { Injectable, OnModuleInit } from '@nestjs/common'

import { QueuePort } from '@/platform/queue/queue.port'
import { ResendFailedRunner } from '../../application/notification.handlers'
import { NotificationDeliveryService } from '../../application/notification-delivery.service'
import {
  NOTIFICATIONS_DELIVER_QUEUE,
  NOTIFICATIONS_RESEND_FAILED_QUEUE,
  NotificationDeliverPayload,
  NotificationsResendFailedPayload,
} from '../../application/notification-queues'

/**
 * Consume la cola de entrega y la del trabajo "reintentar fallidas". Cada
 * mensaje corre dentro del tenant con el que se publicó.
 */
@Injectable()
export class NotificationDeliveryConsumer implements OnModuleInit {
  constructor(
    private readonly queue: QueuePort,
    private readonly delivery: NotificationDeliveryService,
    private readonly resendFailed: ResendFailedRunner,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.consume<NotificationDeliverPayload>(
      NOTIFICATIONS_DELIVER_QUEUE,
      async (message) => {
        await this.delivery.deliver(message.payload.notificationId)
      },
    )
    await this.queue.consume<NotificationsResendFailedPayload>(
      NOTIFICATIONS_RESEND_FAILED_QUEUE,
      (message) => this.resendFailed.run(message.payload),
    )
  }
}
