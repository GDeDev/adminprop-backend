import { ApiProperty } from '@nestjs/swagger'
import { IsJWT, IsNotEmpty, IsString } from 'class-validator'

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token obtenido en el login',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty({ message: 'El refresh token es obligatorio' })
  @IsJWT({ message: 'El refresh token no tiene formato de JWT' })
  refreshToken: string
}
