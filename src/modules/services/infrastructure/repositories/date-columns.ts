import { IsoDate } from '@/shared/dates/calendar-date'

/**
 * Las columnas `DATE` se convierten en el borde (como en contratos, D-49):
 * el dominio sólo ve `AAAA-MM-DD`.
 */
export function toDateColumn(value: IsoDate): Date
export function toDateColumn(value: IsoDate | null): Date | null
export function toDateColumn(value: IsoDate | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}

export function fromDateColumn(value: Date): IsoDate
export function fromDateColumn(value: Date | null): IsoDate | null
export function fromDateColumn(value: Date | null): IsoDate | null {
  return value ? value.toISOString().slice(0, 10) : null
}
