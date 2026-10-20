import { PersonPolicy } from '@/shared/people/person-policy'
import {
  InvalidMoveInDateException,
  InvalidRenterNationalIdException,
} from './renter.exceptions'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Reglas puras de inquilinos. Lo común a toda persona vive en
 * `PersonPolicy`; acá, el DNI con su excepción propia y la fecha de ingreso.
 */
export const RenterPolicy = {
  clean: PersonPolicy.clean,
  normalizeName: PersonPolicy.normalizeName,
  searchKey: PersonPolicy.searchKey,
  normalizeEmail: PersonPolicy.normalizeEmail,
  normalizeNotes: PersonPolicy.normalizeNotes,

  normalizeNationalId(value: string): string {
    const digits = PersonPolicy.parseNationalId(value)
    if (!digits) throw new InvalidRenterNationalIdException()
    return digits
  },

  /**
   * Fecha sin hora, `AAAA-MM-DD`. Se valida que exista en el calendario (un
   * "2026-02-30" pasa la expresión regular pero no es una fecha). Vacío →
   * null: la fecha de ingreso es opcional.
   */
  normalizeMoveInDate(value: string | null | undefined): string | null {
    const trimmed = value?.trim()
    if (!trimmed) return null
    const match = ISO_DATE.exec(trimmed)
    if (!match) throw new InvalidMoveInDateException()
    const [, year, month, day] = match
    const date = new Date(Date.UTC(+year, +month - 1, +day))
    if (
      date.getUTCFullYear() !== +year ||
      date.getUTCMonth() !== +month - 1 ||
      date.getUTCDate() !== +day
    ) {
      throw new InvalidMoveInDateException()
    }
    return trimmed
  },
}
