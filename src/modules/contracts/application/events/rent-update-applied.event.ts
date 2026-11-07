import { IEvent } from '@nestjs/cqrs'

import { IsoDate } from '@/shared/dates/calendar-date'

/**
 * Evento interno de contratos: se aplicó un aumento (por el cron o a mano).
 * Hacia otros módulos viaja por pg-boss como `ContractRentUpdatedPayload`
 * (ver `public/contract-events.ts` y el relay).
 */
export class RentUpdateAppliedEvent implements IEvent {
  constructor(
    public readonly contractId: string,
    public readonly effectiveFrom: IsoDate,
    public readonly previousRent: string,
    public readonly newRent: string,
  ) {}
}
