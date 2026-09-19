import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { ErrorCode } from '../errors/error-codes'

export class ApiErrorDetailDto {
  @ApiProperty({
    description: 'Descripción legible del problema puntual',
    example: 'El email no tiene un formato válido',
  })
  message: string

  @ApiPropertyOptional({
    description: 'Código de la regla que falló',
    example: 'isEmail',
  })
  code?: string

  @ApiPropertyOptional({
    description: 'Campo que originó el error',
    example: 'email',
  })
  field?: string
}

export class ApiErrorDto {
  @ApiProperty({
    description: 'Indica si la operación fue exitosa',
    example: false,
  })
  success: false

  @ApiProperty({ description: 'Status HTTP de la respuesta', example: 400 })
  statusCode: number

  @ApiProperty({
    description: 'Nombre del status HTTP',
    example: 'Bad Request',
  })
  error: string

  @ApiProperty({
    description:
      'Código de error estable. Ramificá por acá, no por el texto del mensaje.',
    enum: ErrorCode,
    example: ErrorCode.VALIDATION_FAILED,
  })
  code: ErrorCode | string

  @ApiProperty({
    description: 'Mensaje legible que describe el error',
    example: 'La validación de los datos enviados falló',
  })
  message: string

  @ApiProperty({
    description: 'Detalle por campo. Vacío si el error no es de validación.',
    type: [ApiErrorDetailDto],
    example: [
      {
        message: 'El email no tiene un formato válido',
        code: 'isEmail',
        field: 'email',
      },
    ],
  })
  errors: ApiErrorDetailDto[]

  @ApiProperty({
    description: 'ID de correlación del request, para rastrearlo en los logs',
    example: '3f8c1b1e-3a6f-4f2e-9a1c-6d9f2b7c4e11',
  })
  correlationId: string

  @ApiProperty({
    description: 'Momento en que se generó el error (ISO 8601)',
    example: '2026-01-15T10:00:00.000Z',
  })
  timestamp: string

  @ApiProperty({
    description: 'Path del request que falló',
    example: '/api/v1/auth/login',
  })
  path: string
}

export class ApiSuccessDto<T> {
  @ApiProperty({
    description: 'Indica si la operación fue exitosa',
    example: true,
  })
  success: true

  @ApiProperty({
    description: 'Mensaje que describe el resultado de la operación',
    example: 'Operación completada correctamente',
    nullable: true,
  })
  message: string | null

  @ApiProperty({ description: 'Payload devuelto por la operación' })
  data: T
}
