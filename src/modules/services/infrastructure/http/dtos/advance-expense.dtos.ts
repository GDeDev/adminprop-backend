import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

import { Currency } from '@/modules/services/domain/property-service'
import { IsMoneyAmount } from '@/shared/money'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value

/** Va como multipart junto con el comprobante (`file`): todo llega como string. */
export class CreateAdvanceExpenseDto {
  @IsMoneyAmount()
  amount: string

  @ApiProperty({ maxLength: 300, example: 'Arreglo de la canilla del baño' })
  @IsString()
  @MinLength(1, { message: 'Describí el gasto' })
  @MaxLength(300)
  description: string

  @ApiProperty({ format: 'date', example: '2026-10-05' })
  @Matches(ISO_DATE, { message: 'La fecha tiene que ser AAAA-MM-DD' })
  expenseDate: string

  @ApiPropertyOptional({
    enum: Currency,
    description: 'Si no viene, la moneda del contrato.',
  })
  @IsOptional()
  @IsEnum(Currency, { message: 'La moneda no es válida' })
  currency?: Currency
}

/**
 * Sólo mientras el gasto está pendiente. Ni el comprobante ni la moneda se
 * cambian: un gasto mal cargado se elimina y se carga de nuevo.
 */
export class UpdateAdvanceExpenseDto extends PartialType(
  OmitType(CreateAdvanceExpenseDto, ['currency'] as const),
) {}

export class ListAdvanceExpensesQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'true: sólo los descontados en una liquidación; false: sólo los pendientes.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'settled tiene que ser true o false' })
  settled?: boolean
}

// ------------------------------------------------------------ Respuestas

export class AdvanceExpenseRegisteredByDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class AdvanceExpenseDto {
  @ApiProperty() id: string
  @ApiProperty() contractId: string
  @ApiProperty({ description: 'Copiado del contrato al registrarlo' })
  renterId: string
  @ApiProperty({ type: String, example: '15000.00' }) amount: string
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty() description: string
  @ApiProperty({ format: 'date' }) expenseDate: string
  @ApiProperty({ description: 'Comprobante (imagen o PDF)' })
  receiptUrl: string
  @ApiProperty({ description: 'Ya descontado en una liquidación' })
  settled: boolean
  @ApiProperty({ type: String, nullable: true }) settlementId: string | null
  @ApiProperty({ type: Date, nullable: true }) settledAt: Date | null
  @ApiProperty({ type: AdvanceExpenseRegisteredByDto, nullable: true })
  registeredBy: AdvanceExpenseRegisteredByDto | null
  @ApiProperty() createdAt: Date
}

export class AdvanceExpenseListDto {
  @ApiProperty({ type: [AdvanceExpenseDto] }) items: AdvanceExpenseDto[]
  @ApiProperty({
    type: String,
    example: '15000.00',
    description: 'Suma de los pendientes del contrato, sin importar el filtro',
  })
  pendingTotal: string
  @ApiProperty({
    type: String,
    example: '0.00',
    description:
      'Suma de los ya descontados del contrato, sin importar el filtro',
  })
  settledTotal: string
}
