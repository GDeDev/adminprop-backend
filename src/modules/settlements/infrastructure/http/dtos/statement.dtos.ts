import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator'

import { FeeMovementType } from '@/modules/settlements/domain/fee.policy'
import {
  CASH_METHODS,
  Currency,
  FeePayer,
  FeeReceivableSource,
  FeeReceivableStatus,
  PaymentMethod,
  StatementSendMode,
  StatementStatus,
} from '@/modules/settlements/domain/settlement'
import { IsMoneyAmount } from '@/shared/money'
import { PaginationQueryDto } from '@/shared/pagination'
import {
  emptyToUndefined,
  ISO_DATE,
  OwnerRefDto,
  PERIOD,
  PropertyRefDto,
  SettlementContractRefDto,
  SettlementSummaryDto,
  UserRefDto,
} from './settlement.dtos'

// --------------------------------------------------------------- Requests

export class CreateOwnerStatementDto {
  @ApiProperty()
  @IsUUID('all')
  ownerId: string

  @ApiProperty({ example: '2026-10' })
  @Matches(PERIOD, { message: 'El período tiene que ser AAAA-MM' })
  period: string
}

export class ListStatementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  ownerId?: string

  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(PERIOD, { message: 'El período tiene que ser AAAA-MM' })
  period?: string

  @ApiPropertyOptional({ enum: StatementStatus })
  @IsOptional()
  @IsEnum(StatementStatus, { message: 'El estado no es válido' })
  status?: StatementStatus
}

export class AddStatementSettlementsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Indicá al menos una liquidación' })
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  settlementIds: string[]
}

export class CloseOwnerStatementDto {
  @ApiPropertyOptional({
    enum: StatementSendMode,
    description:
      'Default: el del consolidado (que nació con el del propietario).',
  })
  @IsOptional()
  @IsEnum(StatementSendMode, { message: 'El modo de envío no es válido' })
  sendMode?: StatementSendMode
}

export class ListFeeReceivablesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  ownerId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  contractId?: string

  @ApiPropertyOptional({ enum: FeeReceivableStatus })
  @IsOptional()
  @IsEnum(FeeReceivableStatus, { message: 'El estado no es válido' })
  status?: FeeReceivableStatus
}

/** Va como multipart junto con el comprobante (`file`): todo llega como string. */
export class RegisterFeePaymentDto {
  @ApiProperty()
  @IsUUID('all')
  ownerId: string

  @ApiPropertyOptional({
    description: 'Si viene, se imputa sólo a los honorarios de ese contrato.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID('all')
  contractId?: string

  @ApiProperty({ format: 'date', example: '2026-10-20' })
  @Matches(ISO_DATE, { message: 'paidAt tiene que ser AAAA-MM-DD' })
  paidAt: string

  @IsMoneyAmount()
  amount: string

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency, { message: 'La moneda no es válida' })
  currency: Currency

  @ApiProperty({ enum: CASH_METHODS })
  @IsIn(CASH_METHODS, { message: 'El medio no es válido' })
  method: PaymentMethod

  @ApiProperty({
    enum: FeePayer,
    description: 'Quién pagó: el propietario, o el inquilino por su cuenta.',
  })
  @IsEnum(FeePayer, { message: 'paidBy no es válido' })
  paidBy: FeePayer

  @ApiPropertyOptional({ type: String, maxLength: 2000 })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(2000)
  notes?: string
}

// -------------------------------------------------------------- Responses

export class OwnerStatementTotalsDto {
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ type: String }) rentTotal: string
  @ApiProperty({ type: String }) lateFeeTotal: string
  @ApiProperty({ type: String, description: 'Cargos del propietario' })
  chargesTotal: string
  @ApiProperty({ type: String }) feeTotal: string
  @ApiProperty({ type: String }) expensesTotal: string
  @ApiProperty({ type: String, description: 'Con signo' })
  adjustmentsTotal: string
  @ApiProperty({
    type: String,
    description: 'Retenciones, con signo (negativo)',
  })
  withholdingsTotal: string
  @ApiProperty({
    type: String,
    description: 'Adelantos al propietario, con signo (negativo)',
  })
  advancesTotal: string
  @ApiProperty({
    type: String,
    description:
      'Otras deducciones y créditos, con signo. Las tres columnas suman `adjustmentsTotal`',
  })
  otherAdjustmentsTotal: string
  @ApiProperty({ type: String }) netTotal: string
  @ApiProperty({ type: String }) transferredTotal: string
}

export class OwnerStatementSummaryDto {
  @ApiProperty() id: string
  @ApiProperty({ type: OwnerRefDto, nullable: true }) owner: OwnerRefDto | null
  @ApiProperty({ example: '2026-10' }) period: string
  @ApiProperty({ enum: StatementStatus }) status: StatementStatus
  @ApiProperty({ enum: StatementSendMode }) sendMode: StatementSendMode
  @ApiProperty() settlementsCount: number
  @ApiProperty({
    type: [OwnerStatementTotalsDto],
    description:
      'Por moneda; congelados al cerrar, en vivo mientras está abierto',
  })
  totals: OwnerStatementTotalsDto[]
  @ApiProperty({ type: Date, nullable: true }) closedAt: Date | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'PDF vigente (Fase 15)',
  })
  pdfUrl: string | null
  @ApiProperty() createdAt: Date
}

export class OwnerStatementDetailDto extends OwnerStatementSummaryDto {
  @ApiProperty({ type: [SettlementSummaryDto] })
  settlements: SettlementSummaryDto[]
  @ApiProperty({ type: UserRefDto, nullable: true }) closedBy: UserRefDto | null
  @ApiProperty({ type: String, nullable: true }) notes: string | null
}

export class FeeReceivableDto {
  @ApiProperty() id: string
  @ApiProperty({ type: OwnerRefDto, nullable: true }) owner: OwnerRefDto | null
  @ApiProperty({ type: SettlementContractRefDto })
  contract: SettlementContractRefDto
  @ApiProperty({ type: PropertyRefDto, nullable: true })
  property: PropertyRefDto | null
  @ApiProperty({ example: '2026-10' }) installmentPeriod: string
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ enum: FeeReceivableSource }) source: FeeReceivableSource
  @ApiProperty({ enum: FeePayer }) payer: FeePayer
  @ApiProperty({ type: String }) amount: string
  @ApiProperty({ type: String }) paidAmount: string
  @ApiProperty({ enum: FeeReceivableStatus }) status: FeeReceivableStatus
  @ApiProperty({ type: String, example: '5.00' }) feePercentage: string
  @ApiProperty({ type: String, nullable: true }) feeAmountFixed: string | null
  @ApiProperty({ type: String }) baseAmount: string
  @ApiProperty({
    description: 'Su pago de origen se anuló con cobros imputados',
  })
  needsReview: boolean
  @ApiProperty() createdAt: Date
}

export class FeePaymentAllocationDto {
  @ApiProperty() feeReceivableId: string
  @ApiProperty({ type: String }) amount: string
}

export class FeePaymentDto {
  @ApiProperty() id: string
  @ApiProperty() ownerId: string
  @ApiProperty({ type: String, nullable: true }) contractId: string | null
  @ApiProperty({ format: 'date' }) paidAt: string
  @ApiProperty({ type: String }) amount: string
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ enum: PaymentMethod }) method: PaymentMethod
  @ApiProperty({ enum: FeePayer }) paidBy: FeePayer
  @ApiProperty({ type: String }) unallocatedAmount: string
  @ApiProperty({ type: String, nullable: true }) receiptUrl: string | null
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: UserRefDto, nullable: true })
  registeredBy: UserRefDto | null
  @ApiProperty({ type: Date, nullable: true }) voidedAt: Date | null
  @ApiProperty({ type: String, nullable: true }) voidReason: string | null
  @ApiProperty({ type: [FeePaymentAllocationDto] })
  allocations: FeePaymentAllocationDto[]
  @ApiProperty() createdAt: Date
}

export class FeeAccountTotalsDto {
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ type: String }) accrued: string
  @ApiProperty({ type: String }) collected: string
  @ApiProperty({ type: String }) pending: string
  @ApiProperty({ type: String }) unallocated: string
}

export class FeeMovementDto {
  @ApiProperty({ format: 'date' }) date: string
  @ApiProperty({ enum: FeeMovementType }) type: FeeMovementType
  @ApiProperty() description: string
  @ApiProperty({ type: String, nullable: true }) debit: string | null
  @ApiProperty({ type: String, nullable: true }) credit: string | null
  @ApiProperty({
    type: String,
    description: 'Saldo acumulado por moneda (deuda positiva)',
  })
  balance: string
  @ApiProperty({ enum: Currency }) currency: Currency
}

export class OwnerFeeAccountDto {
  @ApiProperty() ownerId: string
  @ApiProperty({ type: [FeeAccountTotalsDto] }) totals: FeeAccountTotalsDto[]
  @ApiProperty({ type: [FeeReceivableDto], description: 'Más nuevos primero' })
  receivables: FeeReceivableDto[]
  @ApiProperty({ type: [FeePaymentDto], description: 'Más nuevos primero' })
  payments: FeePaymentDto[]
  @ApiProperty({ type: [FeeMovementDto], description: 'Cronológicos' })
  movements: FeeMovementDto[]
}
