import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator'

import { BCRYPT_MAX_PASSWORD_BYTES } from '../../services/password.service'

export class LoginDto {
  @ApiProperty({ example: 'ana@ejemplo.com' })
  @IsEmail({}, { message: 'El email no tiene un formato válido' })
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string

  @ApiProperty({ example: 'UnaClaveSegura123' })
  // En el login sólo validamos que venga algo: las reglas de fortaleza son para
  // el alta. Aplicarlas acá le contaría al atacante cómo son las contraseñas
  // válidas, y rompería el login de usuarios viejos si alguna vez cambiás la
  // política.
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MaxLength(BCRYPT_MAX_PASSWORD_BYTES)
  password: string
}
