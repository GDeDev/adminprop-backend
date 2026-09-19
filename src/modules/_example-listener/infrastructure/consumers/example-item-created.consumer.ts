import { Injectable, OnModuleInit } from '@nestjs/common'

import {
  EXAMPLE_ITEM_CREATED_QUEUE,
  ExampleItemCreatedPayload,
} from '@/modules/_example/public'
import { RecordExampleCreatedService } from '@/modules/_example-listener/application/record-example-created.service'
import { QueuePort } from '@/platform/queue/queue.port'

/**
 * Se suscribe a la cola del evento. Si el handler falla, pg-boss reintenta y
 * después lo manda a la dead-letter: el efecto no se pierde por un error
 * transitorio ni por un reinicio.
 */
@Injectable()
export class ExampleItemCreatedConsumer implements OnModuleInit {
  constructor(
    private readonly queue: QueuePort,
    private readonly recorder: RecordExampleCreatedService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.consume<ExampleItemCreatedPayload>(
      EXAMPLE_ITEM_CREATED_QUEUE,
      (message) => this.recorder.handle(message.payload),
    )
  }
}
