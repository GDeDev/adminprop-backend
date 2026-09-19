import { IEvent } from '@nestjs/cqrs'

/**
 * Evento de dominio interno de `_example`, emitido por el `EventBus`.
 * Hacia otros módulos viaja como `ExampleItemCreatedPayload` por pg-boss (ver
 * `public/example-events.ts` y el relay).
 */
export class ExampleItemCreatedEvent implements IEvent {
  constructor(
    public readonly exampleItemId: string,
    public readonly name: string,
    public readonly price: string,
  ) {}
}
