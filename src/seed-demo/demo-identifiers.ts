/**
 * Identificadores ficticios con dígitos verificadores VÁLIDOS.
 *
 * Los datos de demo pasan por las mismas validaciones que los reales (el CBU
 * se chequea al cargar un propietario), así que no alcanza con inventar
 * números: tienen que cerrar. Pero tampoco pueden ser de una persona o una
 * cuenta reales, por eso se arman a partir de rangos que no se emiten:
 *
 * - DNI: 90.000.000 en adelante (hoy los DNI llegan a ~60 millones).
 * - CBU: entidad 999 y sucursal 9999, que no existen.
 */

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
const CBU_BLOCK_1_WEIGHTS = [7, 1, 3, 9, 7, 1, 3]
const CBU_BLOCK_2_WEIGHTS = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]

function weightedSum(digits: string, weights: number[]): number {
  return weights.reduce((acc, weight, i) => acc + weight * Number(digits[i]), 0)
}

/** Dígito verificador de un CUIT/CUIL a partir de sus 10 primeros dígitos. */
function cuitCheckDigit(first10: string): number {
  const remainder = weightedSum(first10, CUIT_WEIGHTS) % 11
  return remainder === 0 ? 0 : 11 - remainder
}

export function isValidCuit(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false
  const check = cuitCheckDigit(cuit.slice(0, 10))
  return check !== 10 && check === Number(cuit[10])
}

/**
 * CUIT de una persona ficticia: prefijo (20 hombre, 27 mujer, 30 empresa) más
 * el DNI de 8 dígitos y el verificador. Falla si esa combinación no admite un
 * verificador válido (AFIP la resuelve con otro prefijo): se elige otro DNI.
 */
export function cuitFor(prefix: '20' | '27' | '30', dni: string): string {
  if (!/^\d{8}$/.test(dni)) throw new Error(`DNI inválido: ${dni}`)
  const first10 = `${prefix}${dni}`
  const check = cuitCheckDigit(first10)
  if (check === 10) {
    throw new Error(`El DNI ${dni} no admite un CUIT ${prefix} válido`)
  }
  return `${first10}${check}`
}

/** El CBU ficticio de una cuenta (13 dígitos de cuenta), con los dos verificadores. */
export function cbuFor(account: string): string {
  if (!/^\d{13}$/.test(account)) throw new Error(`Cuenta inválida: ${account}`)
  const block1Base = '9999999'
  const block1 = `${block1Base}${(10 - (weightedSum(block1Base, CBU_BLOCK_1_WEIGHTS) % 10)) % 10}`
  const block2 = `${account}${(10 - (weightedSum(account, CBU_BLOCK_2_WEIGHTS) % 10)) % 10}`
  return `${block1}${block2}`
}

/** DNI ficticio: serie 90.xxx.xxx de la inmobiliaria `series` (1 o 2). */
export function demoDni(series: 1 | 2, index: number): string {
  return String(90_000_000 + series * 100_000 + index)
}
