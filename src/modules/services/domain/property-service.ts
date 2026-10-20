import { IsoDate } from '@/shared/dates/calendar-date'

/** Coinciden con los enums de Prisma. */
export enum Currency {
  ARS = 'ARS',
  USD = 'USD',
}

/** Quién paga el servicio (spec Fase 10, 2.1). */
export enum ServicePayer {
  RENTER = 'RENTER',
  OWNER = 'OWNER',
}

/**
 * Cada cuánto aumenta el servicio. Misma escala que los aumentos del
 * alquiler (`RentUpdateFrequency` en Prisma).
 */
export enum IncreaseFrequency {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  FOUR_MONTHLY = 'FOUR_MONTHLY',
}

/** Calculado al leer, nunca guardado (spec 4, D-64). */
export enum ServiceStatus {
  UP_TO_DATE = 'UP_TO_DATE',
  OVERDUE = 'OVERDUE',
}

/**
 * De dónde le viene un servicio a un contrato (D-66): cargado para ese
 * contrato, o heredado de la propiedad (sin `contractId`).
 */
export enum ServiceScope {
  CONTRACT = 'CONTRACT',
  PROPERTY = 'PROPERTY',
}

/** Servicio asociado a una propiedad y, si lo hay, a un contrato (PRD 5.6). */
export interface PropertyService {
  id: string
  propertyId: string
  /** Null: servicio de la propiedad, que sus contratos heredan. */
  contractId: string | null
  serviceTypeId: string
  paidBy: ServicePayer
  currency: Currency
  hasDueDate: boolean
  dueDate: IsoDate | null
  hasIncrease: boolean
  increaseFrequency: IncreaseFrequency | null
  /** Si la inmobiliaria gestiona el pago o es sólo informativo (spec 7). */
  managedByAgency: boolean
  notes: string | null
  createdAt: Date
  updatedAt: Date
}
