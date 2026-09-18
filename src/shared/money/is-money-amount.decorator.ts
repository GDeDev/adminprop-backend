import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches } from 'class-validator'

/**
 * Hasta 12 dígitos enteros y 2 decimales, con punto: lo que entra en una
 * columna `NUMERIC(14,2)`. Sin separador de miles ni coma decimal: el
 * formateo es cosa del frontend.
 */
export const MONEY_AMOUNT_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/

interface IsMoneyAmountOptions {
  /** Por defecto no se aceptan negativos: casi ningún input de usuario los lleva. */
  allowNegative?: boolean
}

/**
 * Valida un monto de un DTO de entrada. El monto viaja como string (nunca
 * `number`, spec Fase 1 sección 2.1) y se convierte a `Decimal` con
 * `toDecimal()` al entrar al dominio.
 */
export function IsMoneyAmount(options: IsMoneyAmountOptions = {}) {
  const pattern = options.allowNegative
    ? MONEY_AMOUNT_PATTERN
    : /^\d{1,12}(\.\d{1,2})?$/

  return applyDecorators(
    IsString({ message: '$property debe ser un monto en formato string' }),
    Matches(pattern, {
      message:
        '$property debe ser un monto con hasta 2 decimales y punto decimal (ej. "150333.33")',
    }),
    ApiProperty({ type: String, example: '150333.33' }),
  )
}
