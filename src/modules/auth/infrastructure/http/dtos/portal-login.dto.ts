import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsIn, IsString, Matches, MaxLength } from 'class-validator'

import { PORTAL_ROLES, PortalRole } from '@/modules/auth/domain/enums/role.enum'
import { LoginDto } from './login.dto'

/** Mismo formato que `Tenant.slug`. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class PortalLoginDto extends LoginDto {
  @ApiProperty({
    description: 'Slug de la inmobiliaria del portal',
    example: 'demo',
  })
  @IsString()
  @MaxLength(60)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(SLUG_PATTERN, { message: 'La inmobiliaria no es válida' })
  tenantSlug: string

  @ApiProperty({
    enum: PORTAL_ROLES,
    description: 'Portal por el que entra: propietario o inquilino',
    example: 'OWNER',
  })
  @IsIn(PORTAL_ROLES, { message: 'El tipo de portal no es válido' })
  type: PortalRole
}
