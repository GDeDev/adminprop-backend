export { fullNameOf } from '@/shared/people/person-policy'

/**
 * Estado de pago del inquilino, derivado de sus cuotas. Existe desde ya en el
 * contrato de la API para que el frontend lo tipee; recién tiene valor con el
 * motor de cobros (Fase 11). Hasta entonces, siempre null.
 */
export enum PaymentStatus {
  UP_TO_DATE = 'UP_TO_DATE',
  OVERDUE = 'OVERDUE',
}

/** Inquilino (PRD 5.3). */
export interface Renter {
  id: string
  firstName: string
  lastName: string
  /** DNI o CUIT, sólo dígitos. */
  nationalId: string
  phone: string | null
  email: string | null
  address: string | null
  /** Fecha sin hora, `AAAA-MM-DD`. */
  moveInDate: string | null
  notes: string | null
  /** Un solo garante a la vez (spec 4); puede no tener. */
  guarantorId: string | null
  /** Usuario de portal (módulo de auth), si alguna vez se le generó acceso. */
  portalUserId: string | null
  createdAt: Date
  updatedAt: Date
}
