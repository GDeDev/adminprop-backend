import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

import { IsMoneyAmount } from '@/shared/money'

export class CreateExampleItemDto {
  @ApiProperty({ example: 'Ítem de prueba', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string

  @ApiProperty({
    description: 'Monto como string con hasta 2 decimales. Nunca un número.',
    example: '150333.33',
  })
  @IsMoneyAmount()
  price: string
}

export class RecalculateExamplePricesDto {
  @ApiProperty({
    description: 'Aumento en puntos porcentuales ("7.5" = 7,5%)',
    example: '5',
  })
  @IsMoneyAmount()
  percentage: string

  @ApiPropertyOptional({
    description:
      'Demo: el primer intento del worker falla y la cola lo reintenta',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  simulateTransientFailure?: boolean
}

export class ExampleItemDto {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  id: string

  @ApiProperty({ example: 'Ítem de prueba' })
  name: string

  @ApiProperty({ description: 'Monto con 2 decimales', example: '150333.33' })
  price: string

  @ApiProperty({ nullable: true, example: null })
  attachmentUrl: string | null

  @ApiProperty({ example: '2026-09-19T12:00:00.000Z' })
  createdAt: Date
}

export class JobAcceptedDto {
  @ApiProperty({
    description: 'Consultalo en GET /api/v1/jobs/{jobId}/status',
    example: '3f8c1b1e-3a6f-4f2e-9a1c-6d9f2b7c4e11',
  })
  jobId: string
}
