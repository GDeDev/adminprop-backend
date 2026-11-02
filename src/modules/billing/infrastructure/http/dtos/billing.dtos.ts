import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

import {
  ArrearsStatus,
  AccountMovementType,
} from '@/modules/billing/application/account-movement-type'
import {
  ChargeConcept,
  CollectionMode,
  CreditStatus,
  Currency,
  DepositDeductionConcept,
  ExchangeRateSource,
  FeeMode,
  InstallmentStatus,
  LateFeeAdjustmentKind,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
} from '@/modules/billing/domain/billing'
import { DepositReturnMode } from '@/modules/contracts/public'
import { IsMoneyAmount, MONEY_AMOUNT_PATTERN } from '@/shared/money'
import { PaginationQueryDto } from '@/shared/pagination'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD = /^\d{4}-\d{2}$/
const DECIMAL = /^\d{1,12}(\.\d{1,4})?$/

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : value

/** `?renterId=a&renterId=b`, o `?renterIds=a,b`. */
const toIdList = ({ value }: { value: unknown }) => {
  const list = Array.isArray(value) ? value : [value]
  return list
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

// --------------------------------------------------------------- Requests

export class GenerateInstallmentsDto {
  @ApiPropertyOptional({
    example: '2026-11',
    description: 'Mes `AAAA-MM`. Si no viene, el mes siguiente al actual.',
  })
  @IsOptional()
  @Matches(PERIOD, { message: 'El período tiene que ser AAAA-MM' })
  period?: string
}

export class ListInstallmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(PERIOD, { message: 'El período tiene que ser AAAA-MM' })
  period?: string

  @ApiPropertyOptional({
    enum: InstallmentStatus,
    description:
      'OVERDUE: con saldo y la gracia vencida. PENDING y PARTIAL excluyen las vencidas.',
  })
  @IsOptional()
  @IsEnum(InstallmentStatus, { message: 'El estado no es válido' })
  status?: InstallmentStatus

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  contractId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  renterId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  propertyId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  ownerId?: string

  @ApiPropertyOptional({ enum: CollectionMode })
  @IsOptional()
  @IsEnum(CollectionMode, { message: 'La modalidad de cobro no es válida' })
  collectionMode?: CollectionMode
}

export class BillingSummaryQueryDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(PERIOD, { message: 'El período tiene que ser AAAA-MM' })
  period: string
}

export class InstallmentBreakdownQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    description: 'Fecha del desglose. Default hoy.',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'asOf tiene que ser AAAA-MM-DD' })
  asOf?: string
}

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  contractId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  renterId?: string

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus, { message: 'El estado no es válido' })
  status?: PaymentStatus

  @ApiPropertyOptional({ enum: PaymentReceiver })
  @IsOptional()
  @IsEnum(PaymentReceiver, { message: 'receivedBy no es válido' })
  receivedBy?: PaymentReceiver

  @ApiPropertyOptional({ format: 'date', description: 'Fecha de pago desde' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from tiene que ser AAAA-MM-DD' })
  from?: string

  @ApiPropertyOptional({ format: 'date', description: 'Fecha de pago hasta' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'to tiene que ser AAAA-MM-DD' })
  to?: string
}

export class ArrearsQueryDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Repetible: `?renterId=a&renterId=b`.',
  })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsUUID('all', { each: true, message: 'renterId tiene que ser un UUID' })
  renterId?: string[]

  @ApiPropertyOptional({
    type: String,
    description: 'Alternativa: ids separados por coma.',
  })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsUUID('all', { each: true, message: 'renterIds tiene que ser UUIDs' })
  renterIds?: string[]
}

export class CreateChargeDto {
  @ApiProperty({ enum: ChargeConcept })
  @IsEnum(ChargeConcept, { message: 'El concepto no es válido' })
  concept: ChargeConcept

  @ApiProperty({ maxLength: 300, example: 'Expensas de octubre' })
  @IsString()
  @MinLength(1, { message: 'Describí el cargo' })
  @MaxLength(300)
  description: string

  @IsMoneyAmount()
  amount: string
}

/** Va como multipart junto con el comprobante (`file`): todo llega como string. */
export class RegisterPaymentDto {
  @ApiProperty({ format: 'date', example: '2026-10-15' })
  @Matches(ISO_DATE, { message: 'paidAt tiene que ser AAAA-MM-DD' })
  paidAt: string

  @IsMoneyAmount()
  amount: string

  @ApiProperty({ enum: Currency, description: 'Moneda en que se entregó' })
  @IsEnum(Currency, { message: 'La moneda no es válida' })
  paidCurrency: Currency

  @ApiPropertyOptional({
    type: String,
    example: '1487.5000',
    description:
      'Pesos por 1 dólar. Obligatoria (con fuente y fecha) si la moneda difiere de la del contrato.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(DECIMAL, {
    message: 'exchangeRate debe ser un número con hasta 4 decimales',
  })
  exchangeRate?: string

  @ApiPropertyOptional({ enum: ExchangeRateSource })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(ExchangeRateSource, { message: 'La fuente no es válida' })
  exchangeRateSource?: ExchangeRateSource

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(ISO_DATE, { message: 'exchangeRateDate tiene que ser AAAA-MM-DD' })
  exchangeRateDate?: string

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod, { message: 'El medio de pago no es válido' })
  method: PaymentMethod

  @ApiPropertyOptional({
    enum: PaymentReceiver,
    description: 'Default según la modalidad de cobro de la cuota.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(PaymentReceiver, { message: 'receivedBy no es válido' })
  receivedBy?: PaymentReceiver

  @ApiPropertyOptional({
    type: String,
    example: '{"lateFee":"0.00","rent":"100000.00","charges":"0.00"}',
    description:
      'Imputación manual como JSON. Sin ella: punitorio → alquiler → cargos.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  allocation?: string

  @ApiPropertyOptional({
    type: Boolean,
    default: true,
    description: 'Aplica antes los saldos a favor del inquilino.',
  })
  @IsOptional()
  @Transform(toBoolean)
  applyCredit?: boolean

  @ApiPropertyOptional({ type: String, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class ApplyCreditDto {
  @ApiPropertyOptional({
    description:
      'Un crédito puntual; si no, los disponibles del más viejo al más nuevo.',
  })
  @IsOptional()
  @IsUUID('all')
  creditId?: string

  @ApiPropertyOptional({
    type: String,
    example: '20000.00',
    description: 'Hasta este monto; si no, hasta cubrir la deuda.',
  })
  @IsOptional()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount debe ser un monto con hasta 2 decimales',
  })
  amount?: string
}

export class CreateLateFeeAdjustmentDto {
  @ApiProperty({ enum: LateFeeAdjustmentKind })
  @IsEnum(LateFeeAdjustmentKind, { message: 'El tipo de ajuste no es válido' })
  kind: LateFeeAdjustmentKind

  @ApiPropertyOptional({
    type: String,
    example: '5000.00',
    description: 'Sólo REDUCE: lo que se descuenta del punitorio.',
  })
  @IsOptional()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount debe ser un monto con hasta 2 decimales',
  })
  amount?: string

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1, { message: 'Indicá el motivo' })
  @MaxLength(500)
  reason: string
}

export class RefundCreditDto {
  @ApiProperty({ format: 'date', example: '2026-10-20' })
  @Matches(ISO_DATE, { message: 'refundedAt tiene que ser AAAA-MM-DD' })
  refundedAt: string

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod, { message: 'El medio no es válido' })
  method: PaymentMethod

  @ApiPropertyOptional({ type: String, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class DepositDeductionInputDto {
  @ApiProperty({ enum: DepositDeductionConcept })
  @IsEnum(DepositDeductionConcept, { message: 'El concepto no es válido' })
  concept: DepositDeductionConcept

  @ApiProperty({ maxLength: 300, example: 'Cuota de octubre impaga' })
  @IsString()
  @MinLength(1, { message: 'Describí la deducción' })
  @MaxLength(300)
  description: string

  @IsMoneyAmount()
  amount: string

  @ApiPropertyOptional({
    description:
      'Sólo en DEBT: la cuota a la que se imputa. Crea un pago DEPOSIT sobre ella.',
  })
  @IsOptional()
  @IsUUID('all')
  installmentId?: string
}

/** Fase 12, 2.2: `returnedAmount + Σ deducciones` tiene que ser el depósito. */
export class RegisterDepositReturnDto {
  @ApiProperty({ format: 'date', example: '2026-10-31' })
  @Matches(ISO_DATE, { message: 'returnedAt tiene que ser AAAA-MM-DD' })
  returnedAt: string

  @ApiProperty({
    type: String,
    example: '80000.00',
    description: 'Lo que se le devuelve al inquilino; puede ser 0.',
  })
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'returnedAmount debe ser un monto con hasta 2 decimales',
  })
  returnedAmount: string

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod, { message: 'El medio no es válido' })
  method: PaymentMethod

  @ApiPropertyOptional({ type: String, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @ApiProperty({ type: [DepositDeductionInputDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DepositDeductionInputDto)
  deductions: DepositDeductionInputDto[]
}

/** Para anular pagos y cargos. */
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

export class RenterRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class OwnerRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class UserRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class InstallmentContractRefDto {
  @ApiProperty() id: string
}

export class InstallmentSummaryDto {
  @ApiProperty() id: string
  @ApiProperty({ example: '2026-10' }) period: string
  @ApiProperty({ type: InstallmentContractRefDto })
  contract: InstallmentContractRefDto
  @ApiProperty({ type: PropertyRefDto, nullable: true })
  property: PropertyRefDto | null
  @ApiProperty({ type: RenterRefDto, nullable: true })
  renter: RenterRefDto | null
  @ApiProperty({ type: OwnerRefDto, nullable: true })
  owner: OwnerRefDto | null
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ type: String, example: '200000.00' }) baseAmount: string
  @ApiProperty({ type: String }) chargesTotal: string
  @ApiProperty({ type: String, description: 'Punitorio devengado a hoy' })
  lateFeeAccrued: string
  @ApiProperty({ type: String, description: 'Σ reducciones' })
  lateFeeAdjusted: string
  @ApiProperty() lateFeeWaived: boolean
  @ApiProperty({ type: String }) lateFeeBalance: string
  @ApiProperty({ type: String, description: 'Imputado por los pagos vigentes' })
  paidTotal: string
  @ApiProperty({ type: String }) rentBalance: string
  @ApiProperty({ type: String }) chargesBalance: string
  @ApiProperty({ type: String }) totalDue: string
  @ApiProperty({
    type: String,
    description: 'Informado por el propietario, sin confirmar',
  })
  pendingConfirmationTotal: string
  @ApiProperty({ enum: InstallmentStatus }) status: InstallmentStatus
  @ApiProperty({ format: 'date' }) graceEndDate: string
  @ApiProperty({ description: 'Días con punitorio' }) feeDays: number
  @ApiProperty({ type: String, format: 'date', nullable: true })
  paidAt: string | null
  @ApiProperty({ enum: CollectionMode }) collectionMode: CollectionMode
  @ApiProperty({ enum: FeeMode }) feeMode: FeeMode
  @ApiProperty() createdAt: Date
}

export class InstallmentChargeDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: ChargeConcept }) concept: ChargeConcept
  @ApiProperty() description: string
  @ApiProperty({ type: String }) amount: string
  @ApiProperty({ type: UserRefDto, nullable: true })
  createdBy: UserRefDto | null
  @ApiProperty() createdAt: Date
  @ApiProperty({ type: Date, nullable: true }) voidedAt: Date | null
  @ApiProperty({ type: String, nullable: true }) voidReason: string | null
}

export class PaymentDto {
  @ApiProperty() id: string
  @ApiProperty() installmentId: string
  @ApiProperty() contractId: string
  @ApiProperty() renterId: string
  @ApiProperty({ example: '2026-10' }) period: string
  @ApiProperty({ format: 'date' }) paidAt: string
  @ApiProperty({ enum: Currency }) paidCurrency: Currency
  @ApiProperty({ type: String, description: 'En paidCurrency' }) amount: string
  @ApiProperty({ type: String, nullable: true, example: '1487.5000' })
  exchangeRate: string | null
  @ApiProperty({ enum: ExchangeRateSource, nullable: true })
  exchangeRateSource: ExchangeRateSource | null
  @ApiProperty({ type: String, format: 'date', nullable: true })
  exchangeRateDate: string | null
  @ApiProperty({ type: String }) amountInContractCurrency: string
  @ApiProperty({ enum: PaymentKind }) kind: PaymentKind
  @ApiProperty({ enum: PaymentMethod }) method: PaymentMethod
  @ApiProperty({ enum: PaymentReceiver }) receivedBy: PaymentReceiver
  @ApiProperty({ enum: PaymentStatus }) status: PaymentStatus
  @ApiProperty({ type: String }) lateFeeApplied: string
  @ApiProperty({ type: String }) rentApplied: string
  @ApiProperty({ type: String }) chargesApplied: string
  @ApiProperty({ type: String }) creditGenerated: string
  @ApiProperty({ type: String, nullable: true }) creditId: string | null
  @ApiProperty({ type: String, nullable: true }) receiptUrl: string | null
  @ApiProperty({ type: String, nullable: true, example: 'R-00000042' })
  receiptNumber: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'PDF del recibo emitido por la inmobiliaria (Fase 15)',
  })
  receiptPdfUrl: string | null
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: UserRefDto, nullable: true })
  registeredBy: UserRefDto | null
  @ApiProperty({ type: Date, nullable: true }) confirmedAt: Date | null
  @ApiProperty({ type: UserRefDto, nullable: true })
  confirmedBy: UserRefDto | null
  @ApiProperty({ type: Date, nullable: true }) voidedAt: Date | null
  @ApiProperty({ type: UserRefDto, nullable: true }) voidedBy: UserRefDto | null
  @ApiProperty({ type: String, nullable: true }) voidReason: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Liquidación que lo incluyó (Fase 12); null = sin liquidar',
  })
  settlementId: string | null
  @ApiProperty() createdAt: Date
}

export class PaymentListItemDto extends PaymentDto {
  @ApiProperty({ type: RenterRefDto, nullable: true })
  renter: RenterRefDto | null
  @ApiProperty({ type: PropertyRefDto, nullable: true })
  property: PropertyRefDto | null
  @ApiProperty({ enum: Currency, description: 'La del contrato' })
  currency: Currency
}

export class LateFeeAdjustmentDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: LateFeeAdjustmentKind }) kind: LateFeeAdjustmentKind
  @ApiProperty({ type: String }) amount: string
  @ApiProperty() reason: string
  @ApiProperty({ type: UserRefDto, nullable: true })
  createdBy: UserRefDto | null
  @ApiProperty() createdAt: Date
}

export class LateFeeDayDto {
  @ApiProperty({ format: 'date' }) day: string
  @ApiProperty() dayNumber: number
  @ApiProperty({ type: String }) outstandingBase: string
  @ApiProperty({ type: String, example: '5.00' }) dailyPercentage: string
  @ApiProperty({ type: String }) amount: string
}

export class InstallmentDetailDto extends InstallmentSummaryDto {
  @ApiProperty({ type: String, example: '5.00' }) lateFeePercentage: string
  @ApiProperty() lateFeeGraceDays: number
  @ApiProperty({ type: String, example: '5.00' }) feePercentage: string
  @ApiProperty({ type: String, nullable: true }) feeAmount: string | null
  @ApiProperty({ type: String }) feeOnBase: string
  @ApiProperty({ type: String }) feeOnCollected: string
  @ApiProperty({ type: [InstallmentChargeDto] }) charges: InstallmentChargeDto[]
  @ApiProperty({ type: [PaymentDto], description: 'Más nuevos primero' })
  payments: PaymentDto[]
  @ApiProperty({ type: [LateFeeAdjustmentDto] })
  lateFeeAdjustments: LateFeeAdjustmentDto[]
  @ApiProperty({ type: [LateFeeDayDto] }) lateFeeDays: LateFeeDayDto[]
  @ApiProperty({
    type: String,
    description: 'Disponible del inquilino en la moneda del contrato',
  })
  creditsAvailable: string
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty() updatedAt: Date
}

export class InstallmentBreakdownDto {
  @ApiProperty() installmentId: string
  @ApiProperty() period: string
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ format: 'date' }) asOf: string
  @ApiProperty({ enum: InstallmentStatus }) status: InstallmentStatus
  @ApiProperty({ type: String }) baseAmount: string
  @ApiProperty({ type: String }) chargesTotal: string
  @ApiProperty({ format: 'date' }) graceEndDate: string
  @ApiProperty() feeDays: number
  @ApiProperty({ type: String }) lateFeePercentage: string
  @ApiProperty({ type: String }) lateFeeAccrued: string
  @ApiProperty({ type: String }) lateFeeAdjusted: string
  @ApiProperty() lateFeeWaived: boolean
  @ApiProperty({ type: String }) rentPaid: string
  @ApiProperty({ type: String }) chargesPaid: string
  @ApiProperty({ type: String }) lateFeePaid: string
  @ApiProperty({ type: String }) rentBalance: string
  @ApiProperty({ type: String }) chargesBalance: string
  @ApiProperty({ type: String }) lateFeeBalance: string
  @ApiProperty({ type: String }) totalDue: string
  @ApiProperty({ type: String }) creditAvailable: string
  @ApiProperty({ type: String }) totalDueAfterCredit: string
  @ApiProperty({ type: [LateFeeDayDto] }) days: LateFeeDayDto[]
}

export class BillingSummaryByCurrencyDto {
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty() total: number
  @ApiProperty() pending: number
  @ApiProperty() partial: number
  @ApiProperty() overdue: number
  @ApiProperty() paid: number
  @ApiProperty({ type: String }) baseTotal: string
  @ApiProperty({ type: String }) chargesTotal: string
  @ApiProperty({ type: String }) collectedTotal: string
  @ApiProperty({ type: String }) collectedByAgency: string
  @ApiProperty({ type: String }) collectedByOwner: string
  @ApiProperty({ type: String }) pendingConfirmationTotal: string
  @ApiProperty({ type: String }) lateFeeAccrued: string
  @ApiProperty({ type: String }) lateFeeCollected: string
  @ApiProperty({ type: String }) feeAccruedOnBase: string
  @ApiProperty({ type: String }) feeAccruedOnCollected: string
  @ApiProperty({ type: String }) balanceTotal: string
}

export class BillingSummaryDto {
  @ApiProperty({ example: '2026-10' }) period: string
  @ApiProperty({ type: [BillingSummaryByCurrencyDto] })
  byCurrency: BillingSummaryByCurrencyDto[]
}

export class InstallmentGenerationResultDto {
  @ApiProperty({ example: '2026-11' }) period: string
  @ApiProperty({ description: 'Contratos activos que cubren el mes' })
  contracts: number
  @ApiProperty() created: number
  @ApiProperty({ description: 'Ya tenían su cuota' }) skipped: number
}

export class RegisterPaymentResultDto {
  @ApiProperty({ type: PaymentDto }) payment: PaymentDto
  @ApiProperty({
    type: [PaymentDto],
    description: 'Aplicaciones de saldo a favor hechas en la misma operación',
  })
  creditApplications: PaymentDto[]
  @ApiProperty({ type: InstallmentDetailDto }) installment: InstallmentDetailDto
}

export class RenterCreditDto {
  @ApiProperty() id: string
  @ApiProperty() renterId: string
  @ApiProperty() contractId: string
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ type: String }) amount: string
  @ApiProperty({ type: String }) remaining: string
  @ApiProperty({ enum: CreditStatus }) status: CreditStatus
  @ApiProperty() originPaymentId: string
  @ApiProperty() createdAt: Date
  @ApiProperty({ type: String, format: 'date', nullable: true })
  refundedAt: string | null
  @ApiProperty({ enum: PaymentMethod, nullable: true })
  refundMethod: PaymentMethod | null
  @ApiProperty({ type: String, nullable: true }) refundNotes: string | null
}

export class CreditTotalDto {
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ type: String }) available: string
}

export class RenterCreditsDto {
  @ApiProperty() renterId: string
  @ApiProperty({ type: [CreditTotalDto] }) totals: CreditTotalDto[]
  @ApiProperty({
    type: [RenterCreditDto],
    description: 'Todos, más nuevos primero',
  })
  credits: RenterCreditDto[]
}

export class MoneyByCurrencyDto {
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ type: String }) amount: string
}

export class RenterArrearsDto {
  @ApiProperty() renterId: string
  @ApiProperty({ enum: ArrearsStatus }) status: ArrearsStatus
  @ApiProperty() overdueInstallments: number
  @ApiProperty() maxDaysOverdue: number
  @ApiProperty({ type: [MoneyByCurrencyDto] })
  lateFeeAccrued: MoneyByCurrencyDto[]
  @ApiProperty({ type: [MoneyByCurrencyDto] }) balance: MoneyByCurrencyDto[]
}

export class ContractAccountContractDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ enum: CollectionMode }) collectionMode: CollectionMode
  @ApiProperty({ enum: FeeMode }) feeMode: FeeMode
  @ApiProperty({ enum: DepositReturnMode }) depositReturnMode: DepositReturnMode
}

export class ContractAccountTotalsDto {
  @ApiProperty({ type: String }) accrued: string
  @ApiProperty({ type: String }) chargesTotal: string
  @ApiProperty({ type: String }) lateFeeAccrued: string
  @ApiProperty({ type: String }) lateFeeAdjusted: string
  @ApiProperty({ type: String }) collected: string
  @ApiProperty({ type: String }) collectedByAgency: string
  @ApiProperty({ type: String }) collectedByOwner: string
  @ApiProperty({ type: String }) pendingConfirmation: string
  @ApiProperty({ type: String }) balance: string
  @ApiProperty({ type: String }) creditsAvailable: string
  @ApiProperty({ type: String }) feeAccruedOnBase: string
  @ApiProperty({ type: String }) feeAccruedOnCollected: string
}

export class ContractAccountInstallmentDto {
  @ApiProperty() id: string
  @ApiProperty() period: string
  @ApiProperty({ type: String }) baseAmount: string
  @ApiProperty({ type: String }) chargesTotal: string
  @ApiProperty({ type: String }) lateFeeAccrued: string
  @ApiProperty({ type: String }) lateFeeBalance: string
  @ApiProperty({ type: String }) paidTotal: string
  @ApiProperty({ type: String }) totalDue: string
  @ApiProperty({ enum: InstallmentStatus }) status: InstallmentStatus
  @ApiProperty({ format: 'date' }) graceEndDate: string
  @ApiProperty({ type: String, format: 'date', nullable: true })
  paidAt: string | null
}

export class ContractAccountMovementDto {
  @ApiProperty({ format: 'date' }) date: string
  @ApiProperty({ enum: AccountMovementType }) type: AccountMovementType
  @ApiProperty() description: string
  @ApiProperty({ type: String, nullable: true }) debit: string | null
  @ApiProperty({ type: String, nullable: true }) credit: string | null
  @ApiProperty({
    type: String,
    description: 'Saldo acumulado (deuda positiva)',
  })
  balance: string
  @ApiProperty({ type: String, nullable: true }) installmentId: string | null
  @ApiProperty({ type: String, nullable: true }) paymentId: string | null
}

export class DepositReturnDeductionDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: DepositDeductionConcept })
  concept: DepositDeductionConcept
  @ApiProperty() description: string
  @ApiProperty({ type: String }) amount: string
  @ApiProperty({ type: String, nullable: true }) installmentId: string | null
  @ApiProperty({ type: String, nullable: true }) paymentId: string | null
}

export class DepositReturnDto {
  @ApiProperty() id: string
  @ApiProperty() contractId: string
  @ApiProperty({ format: 'date' }) returnedAt: string
  @ApiProperty({ type: String }) depositAmount: string
  @ApiProperty({ enum: Currency }) depositCurrency: Currency
  @ApiProperty({ type: String }) returnedAmount: string
  @ApiProperty({ enum: PaymentMethod }) method: PaymentMethod
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: UserRefDto, nullable: true })
  registeredBy: UserRefDto | null
  @ApiProperty({ type: [DepositReturnDeductionDto] })
  deductions: DepositReturnDeductionDto[]
  @ApiProperty() createdAt: Date
}

export class ContractAccountDepositDto {
  @ApiProperty({ type: String }) amount: string
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({ enum: DepositReturnMode }) returnMode: DepositReturnMode
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'FIXED: el depósito; FOLLOWS_RENT: el alquiler vigente; MANUAL: null',
  })
  suggestedReturn: string | null
  @ApiProperty({ type: DepositReturnDto, nullable: true })
  returned: DepositReturnDto | null
}

export class ContractAccountDto {
  @ApiProperty({ type: ContractAccountContractDto })
  contract: ContractAccountContractDto
  @ApiProperty({ type: ContractAccountTotalsDto })
  totals: ContractAccountTotalsDto
  @ApiProperty({ type: [ContractAccountInstallmentDto] })
  installments: ContractAccountInstallmentDto[]
  @ApiProperty({
    type: [ContractAccountMovementDto],
    description: 'Cronológico ascendente',
  })
  movements: ContractAccountMovementDto[]
  @ApiProperty({ type: ContractAccountDepositDto })
  deposit: ContractAccountDepositDto
}
