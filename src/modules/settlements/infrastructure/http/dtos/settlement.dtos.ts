import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

import {
  CASH_METHODS,
  Currency,
  FeeMode,
  PaymentMethod,
  SettlementAdjustmentConcept,
  SettlementStatus,
} from '@/modules/settlements/domain/settlement'
import { IsMoneyAmount } from '@/shared/money'
import { PaginationQueryDto } from '@/shared/pagination'

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export const PERIOD = /^\d{4}-\d{2}$/

export const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

// --------------------------------------------------------------- Requests

export class CreateSettlementDto {
  @ApiProperty()
  @IsUUID('all')
  contractId: string

  @ApiPropertyOptional({
    example: '2026-10',
    description: 'Mes de la liquidación. Si no viene, el mes actual.',
  })
  @IsOptional()
  @Matches(PERIOD, { message: 'El período tiene que ser AAAA-MM' })
  period?: string
}

export class ListSettlementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  ownerId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  propertyId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  contractId?: string

  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(PERIOD, { message: 'El período tiene que ser AAAA-MM' })
  period?: string

  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus, { message: 'El estado no es válido' })
  status?: SettlementStatus
}

export class OwnerSettlementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(PERIOD, { message: 'El período tiene que ser AAAA-MM' })
  period?: string

  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus, { message: 'El estado no es válido' })
  status?: SettlementStatus
}

export class CreateSettlementAdjustmentDto {
  @ApiProperty({
    enum: SettlementAdjustmentConcept,
    description:
      'WITHHOLDING, OWNER_ADVANCE y OTHER_DEDUCTION restan; OTHER_CREDIT suma.',
  })
  @IsEnum(SettlementAdjustmentConcept, { message: 'El concepto no es válido' })
  concept: SettlementAdjustmentConcept

  @ApiProperty({ maxLength: 300, example: 'Retención IIBB' })
  @IsString()
  @MinLength(1, { message: 'Describí el ajuste' })
  @MaxLength(300)
  description: string

  @IsMoneyAmount()
  amount: string
}

/** Va como multipart junto con el comprobante (`file`): todo llega como string. */
export class RegisterSettlementTransferDto {
  @ApiProperty({ format: 'date', example: '2026-10-20' })
  @Matches(ISO_DATE, { message: 'transferredAt tiene que ser AAAA-MM-DD' })
  transferredAt: string

  @IsMoneyAmount()
  amount: string

  @ApiProperty({ enum: CASH_METHODS })
  @IsIn(CASH_METHODS, { message: 'El medio no es válido' })
  method: PaymentMethod

  @ApiPropertyOptional({ type: String, maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(2000)
  notes?: string
}

/** Para anular ajustes, transferencias y pagos de honorarios, y cancelar liquidaciones. */
export class VoidDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1, { message: 'Indicá el motivo' })
  @MaxLength(500)
  reason: string
}

// -------------------------------------------------------------- Responses

export class PropertyRefDto {
  @ApiProperty() id: string
  @ApiProperty() address: string
}

export class OwnerRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class RenterRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class UserRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class SettlementContractRefDto {
  @ApiProperty() id: string
}

export class SettlementSummaryDto {
  @ApiProperty() id: string
  @ApiProperty({ example: '2026-10', description: 'Mes en que se liquida' })
  period: string
  @ApiProperty({ description: 'Parcial N del mes' }) sequence: number
  @ApiProperty({ enum: SettlementStatus }) status: SettlementStatus
  @ApiProperty({ type: SettlementContractRefDto })
  contract: SettlementContractRefDto
  @ApiProperty({ type: PropertyRefDto, nullable: true })
  property: PropertyRefDto | null
  @ApiProperty({ type: OwnerRefDto, nullable: true }) owner: OwnerRefDto | null
  @ApiProperty({ type: RenterRefDto, nullable: true })
  renter: RenterRefDto | null
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ type: String }) rentTotal: string
  @ApiProperty({ type: String }) lateFeeTotal: string
  @ApiProperty({
    type: String,
    description: 'Cargos TERMINATION_PENALTY y OTHER',
  })
  ownerChargesTotal: string
  @ApiProperty({
    type: String,
    description: 'Cargos SERVICE: no entran al neto',
  })
  serviceChargesTotal: string
  @ApiProperty({ type: String }) feeTotal: string
  @ApiProperty({ description: 'Los honorarios se descontaron del neto' })
  feeDeducted: boolean
  @ApiProperty({ type: String }) expensesTotal: string
  @ApiProperty({ type: String, description: 'Con signo' })
  adjustmentsTotal: string
  @ApiProperty({ type: String, description: 'Puede ser negativo' })
  netAmount: string
  @ApiProperty({ type: String }) transferredTotal: string
  @ApiProperty({ type: String, nullable: true }) statementId: string | null
  @ApiProperty() hasVoidedPayments: boolean
  @ApiProperty({ type: Date, nullable: true }) confirmedAt: Date | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'PDF vigente (Fase 15)',
  })
  pdfUrl: string | null
  @ApiProperty() createdAt: Date
}

export class SettlementPaymentDto {
  @ApiProperty() paymentId: string
  @ApiProperty() installmentId: string
  @ApiProperty({ example: '2026-09' }) installmentPeriod: string
  @ApiProperty({ format: 'date' }) paidAt: string
  @ApiProperty({ type: String }) rentApplied: string
  @ApiProperty({ type: String }) lateFeeApplied: string
  @ApiProperty({ type: String }) ownerChargesApplied: string
  @ApiProperty({ type: String }) serviceChargesApplied: string
}

export class SettlementExpenseDto {
  @ApiProperty() expenseId: string
  @ApiProperty() description: string
  @ApiProperty({ format: 'date' }) expenseDate: string
  @ApiProperty({ type: String }) amount: string
  @ApiProperty({ enum: Currency }) currency: Currency
}

export class SettlementAdjustmentDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: SettlementAdjustmentConcept })
  concept: SettlementAdjustmentConcept
  @ApiProperty() description: string
  @ApiProperty({
    type: String,
    description: 'Siempre positivo; el signo lo da el concepto',
  })
  amount: string
  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description: 'Null en los automáticos',
  })
  createdBy: UserRefDto | null
  @ApiProperty() createdAt: Date
  @ApiProperty({ type: Date, nullable: true }) voidedAt: Date | null
  @ApiProperty({ type: String, nullable: true }) voidReason: string | null
}

export class SettlementTransferDto {
  @ApiProperty() id: string
  @ApiProperty({ format: 'date' }) transferredAt: string
  @ApiProperty({ type: String }) amount: string
  @ApiProperty({ enum: PaymentMethod }) method: PaymentMethod
  @ApiProperty({ type: String, nullable: true }) receiptUrl: string | null
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: UserRefDto, nullable: true })
  registeredBy: UserRefDto | null
  @ApiProperty({ type: Date, nullable: true }) voidedAt: Date | null
}

export class SettlementDetailDto extends SettlementSummaryDto {
  @ApiProperty({
    enum: FeeMode,
    description: 'De la cuota más reciente incluida',
  })
  feeMode: FeeMode
  @ApiProperty({ type: String, example: '5.00' }) feePercentage: string
  @ApiProperty({ type: String, nullable: true }) feeAmountFixed: string | null
  @ApiProperty({
    type: String,
    description: 'Sobre qué se calculó el honorario',
  })
  feeBase: string
  @ApiProperty({
    description: 'Las cuotas incluidas tenían términos distintos',
  })
  mixedFeeTerms: boolean
  @ApiProperty({
    description:
      'El propietario no tiene cuenta bancaria cargada (A-17: se avisa)',
  })
  ownerBankAccountMissing: boolean
  @ApiProperty({ type: [SettlementPaymentDto] })
  payments: SettlementPaymentDto[]
  @ApiProperty({ type: [SettlementExpenseDto] })
  expenses: SettlementExpenseDto[]
  @ApiProperty({
    type: [SettlementExpenseDto],
    description:
      'Gastos pendientes en otra moneda que el contrato: no se descuentan',
  })
  skippedExpenses: SettlementExpenseDto[]
  @ApiProperty({ type: [SettlementAdjustmentDto] })
  adjustments: SettlementAdjustmentDto[]
  @ApiProperty({ type: [SettlementTransferDto] })
  transfers: SettlementTransferDto[]
  @ApiProperty({ type: UserRefDto, nullable: true })
  confirmedBy: UserRefDto | null
  @ApiProperty({ type: Date, nullable: true }) cancelledAt: Date | null
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'Cuándo el propietario acusó recibo de la transferencia desde el portal (A-37)',
  })
  acknowledgedAt: Date | null
  @ApiProperty() updatedAt: Date
}
