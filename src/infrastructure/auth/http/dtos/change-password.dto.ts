import { ApiProperty } from '@nestjs/swagger'
import {
  IsNotEmpty,
  IsString,
  IsStrongPassword,
  MaxLength,
  MinLength,
} from 'class-validator'

import { BCRYPT_MAX_PASSWORD_BYTES } from '../../services/password.service'

export class ChangePasswordDto {
  @ApiProperty({ description: 'Contraseña actual' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña actual es obligatoria' })
  @MaxLength(BCRYPT_MAX_PASSWORD_BYTES)
  currentPassword: string

  @ApiProperty({
    description:
      'Contraseña nueva. Mínimo 10 caracteres, con minúscula, mayúscula y número.',
    minLength: 10,
    maxLength: BCRYPT_MAX_PASSWORD_BYTES,
  })
  @IsString()
  @MinLength(10, { message: 'La contraseña debe tener al menos 10 caracteres' })
  @MaxLength(BCRYPT_MAX_PASSWORD_BYTES, {
    message: `La contraseña no puede superar los ${BCRYPT_MAX_PASSWORD_BYTES} caracteres`,
  })
  @IsStrongPassword(
    {
      minLength: 10,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 0,
    },
    {
      message:
        'La contraseña debe incluir al menos una minúscula, una mayúscula y un número',
    },
  )
  newPassword: string
}
