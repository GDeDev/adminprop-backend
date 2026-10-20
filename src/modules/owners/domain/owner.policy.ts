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

/** Espacios de más y vacíos → null. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\s+/g, ' ')
  return trimmed ? trimmed : null
}

export const OwnerPolicy = {
  clean,

  normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ')
  },

  /**
   * Texto de búsqueda: minúsculas y sin acentos, así "perez" encuentra a
   * "Pérez" (nadie tipea los acentos en un buscador).
   */
  searchKey(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
  },

  normalizeEmail(value: string | null | undefined): string | null {
    return clean(value)?.toLowerCase() ?? null
  },

  /**
   * DNI (7-8 dígitos) o CUIT/CUIL (11), sin puntos ni guiones: así
   * "20.123.456" y "20123456" son el mismo propietario para la unicidad.
   */
  normalizeNationalId(value: string): string {
    const digits = value.replace(/[\s.-]/g, '')
    if (!/^\d{7,11}$/.test(digits)) throw new InvalidNationalIdException()
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
    const cbu = clean(account.cbu)?.replace(/[\s-]/g, '') ?? null
    if (cbu !== null && !OwnerPolicy.isValidCbu(cbu)) {
      throw new InvalidCbuException()
    }
    return {
      cbu,
      alias: clean(account.alias)?.toLowerCase() ?? null,
      bankName: clean(account.bankName),
      holder: clean(account.holder),
    }
  },
}
