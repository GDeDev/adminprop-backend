import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsOptional,
  IsString,
  IsStrongPassword,
  MaxLength,
  MinLength,
} from 'class-validator'

import { BCRYPT_MAX_PASSWORD_BYTES } from '../../services/password.service'

export class RegisterDto {
  @ApiProperty({ example: 'ana@ejemplo.com', maxLength: 255 })
  @IsEmail({}, { message: 'El email no tiene un formato válido' })
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string

  @ApiProperty({
    example: 'UnaClaveSegura123',
    minLength: 10,
    maxLength: BCRYPT_MAX_PASSWORD_BYTES,
    description:
      'Mínimo 10 caracteres, con al menos una minúscula, una mayúscula y un número',
  })
  @IsString()
  @MinLength(10, {
    message: 'La contraseña debe tener al menos 10 caracteres',
  })
  // bcrypt ignora todo lo que pase de 72 bytes: mejor rechazarlo que truncar
  // en silencio y que el usuario crea que tiene una contraseña más larga.
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
  password: string

  @ApiPropertyOptional({ example: 'Ana', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  firstName?: string

  @ApiPropertyOptional({ example: 'Gómez', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  lastName?: string
}
