import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  PickType,
} from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

import {
  INTERNAL_ROLES,
  InternalRole,
} from '@/modules/auth/domain/enums/role.enum'
import { PaginationQueryDto } from '@/shared/pagination'
import { StrongPassword } from './strong-password.decorator'

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: INTERNAL_ROLES })
  @IsOptional()
  @IsIn(INTERNAL_ROLES, { message: 'El rol no es válido' })
  role?: InternalRole

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'true: sólo activos; false: sólo desactivados; sin valor: todos',
  })
  @IsOptional()
  // Los query params llegan como string: "false" sería truthy sin esto.
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean({ message: 'isActive tiene que ser true o false' })
  isActive?: boolean
}

export class CreateUserDto {
  @ApiProperty({ example: 'ana@inmobiliaria.com' })
  @IsEmail({}, { message: 'El email no tiene un formato válido' })
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string

  @ApiProperty({ example: 'Ana' })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  firstName: string

  @ApiProperty({ example: 'Gómez' })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @MaxLength(100)
  lastName: string

  @ApiProperty({ enum: INTERNAL_ROLES, example: 'EMPLOYEE' })
  @IsIn(INTERNAL_ROLES, { message: 'El rol tiene que ser ADMIN o EMPLOYEE' })
  role: InternalRole

  @StrongPassword(
    'Contraseña inicial. Se la pasás a la persona; la puede cambiar después.',
  )
  password: string
}

export class UpdateUserDto extends PartialType(
  PickType(CreateUserDto, ['email', 'firstName', 'lastName', 'role'] as const),
) {}

export class ResetUserPasswordDto {
  @StrongPassword('Contraseña nueva. Cierra todas las sesiones del usuario.')
  newPassword: string
}
