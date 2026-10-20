import { PersonPolicy } from '@/shared/people/person-policy'
import {
  GuarantorDetailRequiredException,
  InvalidGuarantorNationalIdException,
} from './guarantor.exceptions'

/**
 * Reglas puras de garantes. Lo común a toda persona vive en `PersonPolicy`;
 * acá, el DNI con su excepción propia y el detalle de la garantía.
 */
export const GuarantorPolicy = {
  clean: PersonPolicy.clean,
  normalizeName: PersonPolicy.normalizeName,
  searchKey: PersonPolicy.searchKey,
  normalizeEmail: PersonPolicy.normalizeEmail,
  normalizeNotes: PersonPolicy.normalizeNotes,

  normalizeNationalId(value: string): string {
    const digits = PersonPolicy.parseNationalId(value)
    if (!digits) throw new InvalidGuarantorNationalIdException()
    return digits
  },

  /**
   * Texto libre (spec 4): no se valida el formato, sólo que diga algo. Se
   * conservan los saltos de línea, como en las notas.
   */
  normalizeGuaranteeDetail(value: string | null | undefined): string {
    const detail = PersonPolicy.normalizeNotes(value)
    if (!detail) throw new GuarantorDetailRequiredException()
    return detail
  },
}
