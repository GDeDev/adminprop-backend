import { IEvent } from '@nestjs/cqrs'

import { Period } from '@/shared/dates/calendar-date'

/**
 * Evento interno de cobros: una cuota quedó saldada (sin saldo de alquiler,
 * cargos ni punitorio). Hacia otros módulos viaja por pg-boss como
 * `InstallmentPaidPayload` (ver `public/billing-events.ts` y el relay).
 */
export class InstallmentPaidEvent implements IEvent {
  constructor(
    public readonly installmentId: string,
    public readonly contractId: string,
    public readonly ownerId: string,
    public readonly period: Period,
  ) {}
}
