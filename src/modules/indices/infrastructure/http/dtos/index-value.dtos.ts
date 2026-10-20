import { ApiProperty } from '@nestjs/swagger'
import { IsEnum, IsString, Matches, MaxLength } from 'class-validator'

import { IndexType } from '@/modules/indices/domain/index-value'

export class RegisterIndexValueDto {
  @ApiProperty({ enum: IndexType, example: IndexType.ICL })
  @IsEnum(IndexType, { message: 'El índice no es válido' })
  indexType: IndexType

  @ApiProperty({ example: '2026-03', description: 'Mes, AAAA-MM' })
  @IsString()
  @MaxLength(7)
  period: string

  @ApiProperty({
    type: String,
    example: '1234.567890',
    description:
      'Valor publicado, como string decimal con hasta 6 decimales y punto.',
  })
  @IsString()
  @Matches(/^\d{1,8}(\.\d{1,6})?$/, {
    message: 'value debe ser un número con hasta 6 decimales (ej. "1234.5678")',
  })
  value: string
}

export class ListIndexValuesQueryDto {
  @ApiProperty({ enum: IndexType, example: IndexType.ICL, name: 'type' })
  @IsEnum(IndexType, { message: 'El índice no es válido' })
  type: IndexType
}

// ------------------------------------------------------------ Respuestas

export class IndexValueDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: IndexType }) indexType: IndexType
  @ApiProperty({ example: '2026-03' }) period: string
  @ApiProperty({ type: String, example: '1234.567890' }) value: string
  @ApiProperty({ example: 'manual' }) source: string
  @ApiProperty() createdAt: Date
}
