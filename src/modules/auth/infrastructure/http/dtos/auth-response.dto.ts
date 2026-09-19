import { ApiProperty } from '@nestjs/swagger'

import { Role } from '@/modules/auth/domain/enums/role.enum'

export class AuthTokensDto {
  @ApiProperty({ description: 'JWT de acceso, va en el header Authorization' })
  accessToken: string

  @ApiProperty({
    description:
      'Token para renovar el acceso. Se rota en cada uso: guardá siempre el último.',
  })
  refreshToken: string

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer'

  @ApiProperty({
    description: 'Segundos hasta que venza el access token',
    example: 900,
  })
  expiresIn: number
}

export class PublicUserDto {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  id: string

  @ApiProperty({
    description: 'Inmobiliaria a la que pertenece el usuario',
    example: '3f8c1b1e-3a6f-4f2e-9a1c-6d9f2b7c4e11',
  })
  tenantId: string

  @ApiProperty({ example: 'ana@ejemplo.com' })
  email: string

  @ApiProperty({ type: String, example: 'Ana', nullable: true })
  firstName: string | null

  @ApiProperty({ type: String, example: 'Gómez', nullable: true })
  lastName: string | null

  @ApiProperty({ enum: Role, example: Role.EMPLOYEE })
  role: Role

  @ApiProperty({ example: true })
  isActive: boolean

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-01-15T10:00:00.000Z',
  })
  lastLoginAt: Date | null

  @ApiProperty({ example: '2026-01-01T09:00:00.000Z' })
  createdAt: Date
}

export class AuthResultDto {
  @ApiProperty({ type: PublicUserDto })
  user: PublicUserDto

  @ApiProperty({ type: AuthTokensDto })
  tokens: AuthTokensDto
}

export class RevokedSessionsDto {
  @ApiProperty({
    description: 'Cantidad de sesiones que se cerraron',
    example: 3,
  })
  revokedSessions: number
}
