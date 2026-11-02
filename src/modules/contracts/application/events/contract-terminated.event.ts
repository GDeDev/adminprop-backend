import { IEvent } from '@nestjs/cqrs'

import { IsoDate } from '@/shared/dates/calendar-date'

/**
 * Evento interno de contratos: se rescindió un contrato (Fase 15). Hacia otros
 * módulos viaja por pg-boss como `ContractTerminatedPayload` (ver
 * `public/contract-events.ts` y el relay): los PDFs generan el cálculo de la
 * rescisión.
 */
export class ContractTerminatedEvent implements IEvent {
  constructor(
    public readonly contractId: string,
    public readonly notifiedAt: IsoDate,
    public readonly penalty: string,
    public readonly futureRent: string,
  ) {}
}
