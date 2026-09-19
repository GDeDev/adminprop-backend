import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

import { BCRYPT_MAX_PASSWORD_BYTES } from '../../services/password.service'
import { StrongPassword } from './strong-password.decorator'

export class ChangePasswordDto {
  @ApiProperty({ description: 'Contraseña actual' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña actual es obligatoria' })
  @MaxLength(BCRYPT_MAX_PASSWORD_BYTES)
  currentPassword: string

  @StrongPassword('Contraseña nueva.')
  newPassword: string
}
