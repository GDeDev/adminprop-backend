import { PersonPolicy } from '@/shared/people/person-policy'
import { BankAccount } from './owner'
import {
  InvalidCbuException,
  InvalidNationalIdException,
} from './owner.exceptions'

const CBU_BLOCK_1_WEIGHTS = [7, 1, 3, 9, 7, 1, 3]
const CBU_BLOCK_2_WEIGHTS = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, weight, i) => acc + weight * +digits[i], 0)
  return (10 - (sum % 10)) % 10
}

/**
 * Reglas puras de propietarios. Lo que es común a toda persona (nombre, DNI,
 * email, búsqueda) vive en `PersonPolicy`; acá queda lo propio: la cuenta
 * bancaria.
 */
export const OwnerPolicy = {
  clean: PersonPolicy.clean,
  normalizeName: PersonPolicy.normalizeName,
  searchKey: PersonPolicy.searchKey,
  normalizeEmail: PersonPolicy.normalizeEmail,

  /** DNI o CUIT a dígitos (ver `PersonPolicy.parseNationalId`). */
  normalizeNationalId(value: string): string {
    const digits = PersonPolicy.parseNationalId(value)
    if (!digits) throw new InvalidNationalIdException()
    return digits
  },

  /**
   * El CBU tiene dos bloques (8 y 14 dígitos), cada uno con su dígito
   * verificador. Validarlos atrapa un dígito mal tipeado antes de que una
   * transferencia rebote (o, peor, llegue a otra cuenta).
   */
  isValidCbu(cbu: string): boolean {
    if (!/^\d{22}$/.test(cbu)) return false
    const block1 = cbu.slice(0, 8)
    const block2 = cbu.slice(8)
    return (
      checkDigit(block1, CBU_BLOCK_1_WEIGHTS) === +block1[7] &&
      checkDigit(block2, CBU_BLOCK_2_WEIGHTS) === +block2[13]
    )
  },

  normalizeBankAccount(account: BankAccount): BankAccount {
    const cbu = PersonPolicy.clean(account.cbu)?.replace(/[\s-]/g, '') ?? null
    if (cbu !== null && !OwnerPolicy.isValidCbu(cbu)) {
      throw new InvalidCbuException()
    }
    return {
      cbu,
      alias: PersonPolicy.clean(account.alias)?.toLowerCase() ?? null,
      bankName: PersonPolicy.clean(account.bankName),
      holder: PersonPolicy.clean(account.holder),
    }
  },
}
