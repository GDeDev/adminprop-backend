import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import {
  IsString,
  IsStrongPassword,
  MaxLength,
  MinLength,
} from 'class-validator'

import { BCRYPT_MAX_PASSWORD_BYTES } from '../../services/password.service'

export const MIN_PASSWORD_LENGTH = 10

/**
 * Política de contraseñas para toda contraseña que se **define** (cambio,
 * alta de usuario, reseteo por admin). En el login no se aplica: ahí sólo se
 * valida que venga algo.
 */
export function StrongPassword(description: string) {
  return applyDecorators(
    ApiProperty({
      description: `${description} Mínimo ${MIN_PASSWORD_LENGTH} caracteres, con minúscula, mayúscula y número.`,
      minLength: MIN_PASSWORD_LENGTH,
      maxLength: BCRYPT_MAX_PASSWORD_BYTES,
    }),
    IsString(),
    MinLength(MIN_PASSWORD_LENGTH, {
      message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
    }),
    MaxLength(BCRYPT_MAX_PASSWORD_BYTES, {
      message: `La contraseña no puede superar los ${BCRYPT_MAX_PASSWORD_BYTES} caracteres`,
    }),
    IsStrongPassword(
      {
        minLength: MIN_PASSWORD_LENGTH,
        minLowercase: 1,
        minUppercase: 1,
        minNumbers: 1,
        minSymbols: 0,
      },
      {
        message:
          'La contraseña debe incluir al menos una minúscula, una mayúscula y un número',
      },
    ),
  )
}
