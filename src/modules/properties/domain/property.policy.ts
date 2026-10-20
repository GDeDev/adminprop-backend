import { MAX_PHOTOS_PER_PROPERTY, PropertyStatus } from './property'
import {
  InvalidStatusTransitionException,
  PropertyHasActiveContractException,
  PropertyHasContractHistoryException,
  TooManyPhotosException,
} from './property.exceptions'

/**
 * Transiciones manuales de estado (spec Fase 6, 4). Las automáticas (al crear
 * o terminar un contrato) las hace la Fase 9 sin pasar por acá.
 */
const MANUAL_TRANSITIONS: Record<PropertyStatus, PropertyStatus[]> = {
  // disponible → alquilada: raro, pero válido (una reserva).
  [PropertyStatus.AVAILABLE]: [
    PropertyStatus.RENTED,
    PropertyStatus.MAINTENANCE,
  ],
  [PropertyStatus.RENTED]: [
    PropertyStatus.AVAILABLE,
    PropertyStatus.MAINTENANCE,
  ],
  // en mantenimiento → disponible; a alquilada se llega con un contrato.
  [PropertyStatus.MAINTENANCE]: [PropertyStatus.AVAILABLE],
}

/** Reglas de negocio de las propiedades. Puras: sin NestJS ni Prisma. */
export const PropertyPolicy = {
  /** "  Av.  Corrientes   1234 " → "Av. Corrientes 1234". */
  normalizeAddress(address: string): string {
    return address.trim().replace(/\s+/g, ' ')
  },

  /** Notas vacías se guardan como null, no como "". */
  normalizeNotes(notes: string | null | undefined): string | null {
    const trimmed = notes?.trim()
    return trimmed ? trimmed : null
  },

  /**
   * Cambio manual de estado. Con un contrato activo, pasar a disponible (o
   * volver a "alquilar" a mano) se rechaza: eso lo decide el contrato.
   * Pasar al mismo estado es un no-op válido.
   */
  assertCanChangeStatus(
    from: PropertyStatus,
    to: PropertyStatus,
    hasActiveContract: boolean,
  ): void {
    if (from === to) return
    if (!MANUAL_TRANSITIONS[from].includes(to)) {
      throw new InvalidStatusTransitionException(from, to)
    }
    if (
      hasActiveContract &&
      (to === PropertyStatus.AVAILABLE || to === PropertyStatus.RENTED)
    ) {
      throw new PropertyHasActiveContractException()
    }
  },

  assertCanAddPhotos(current: number, incoming: number): void {
    if (current + incoming > MAX_PHOTOS_PER_PROPERTY) {
      throw new TooManyPhotosException(current, incoming)
    }
  },

  /** Spec 3.8: con historial de contratos no se borra (queda como registro). */
  assertCanDelete(hasContractHistory: boolean): void {
    if (hasContractHistory) throw new PropertyHasContractHistoryException()
  },
}
