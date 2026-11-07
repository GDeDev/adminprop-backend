import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

import {
  CollectionMode,
  ContractStatus,
  Currency,
  DepositReturnMode,
  FeeMode,
  RentUpdateFrequency,
  RentUpdateSource,
  RentUpdateType,
} from '@/modules/contracts/domain/contract'
import { IsMoneyAmount, MONEY_AMOUNT_PATTERN } from '@/shared/money'
import { PaginationQueryDto } from '@/shared/pagination'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Un string vacío en un campo opcional es "sin dato", no un error. */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value

/** Un % con hasta dos decimales ("5", "5.5", "12.50"). El rango lo valida el dominio. */
const PERCENTAGE = /^\d{1,3}(\.\d{1,2})?$/

/** Los términos de cobro que se eligen al armar o renovar un contrato (D-70). */
export class ContractBillingTermsInputDto {
  @ApiPropertyOptional({
    enum: CollectionMode,
    description: 'Quién cobra el alquiler. Default AGENCY.',
  })
  @IsOptional()
  @IsEnum(CollectionMode, { message: 'La modalidad de cobro no es válida' })
  collectionMode?: CollectionMode

  @ApiPropertyOptional({
    enum: FeeMode,
    description: 'Cómo cobra sus honorarios la inmobiliaria. Default DEDUCTED.',
  })
  @IsOptional()
  @IsEnum(FeeMode, { message: 'La modalidad de honorarios no es válida' })
  feeMode?: FeeMode

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '25000.00',
    description: 'Importe fijo de honorarios; si viene, manda sobre el %.',
  })
  @IsOptional()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'feeAmount debe ser un monto con hasta 2 decimales',
  })
  feeAmount?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '5.00',
    description:
      'Punitorio diario en %. Si no viene, el de la inmobiliaria; si la inmobiliaria no fijó uno, es obligatorio (422).',
  })
  @IsOptional()
  @Matches(PERCENTAGE, {
    message: 'lateFeePercentage debe ser un porcentaje con hasta 2 decimales',
  })
  lateFeePercentage?: string | null

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 10,
    description:
      'Días del mes sin punitorio. Si no viene, los de la inmobiliaria.',
  })
  @IsOptional()
  @IsInt({ message: 'lateFeeGraceDays tiene que ser un entero' })
  @Min(0)
  lateFeeGraceDays?: number | null

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 11,
    description:
      'Día del mes desde el que corre el punitorio (1 a 31). Es la gracia dicha al revés (inicio = gracia + 1): no se combina con lateFeeGraceDays.',
  })
  @IsOptional()
  @IsInt({ message: 'lateFeeStartDay tiene que ser un entero' })
  @Min(1)
  @Max(31)
  lateFeeStartDay?: number | null
}

export class ContractSuretyInputDto {
  @ApiProperty({ description: 'Si el contrato exige seguro de caución' })
  @IsBoolean()
  hasSurety: boolean

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 150 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(150)
  insurerName?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Obligatorio con caución: ahí va la alerta automática (RN-10).',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail({}, { message: 'El email de la aseguradora no es válido' })
  @MaxLength(255)
  insurerAlertEmail?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  policyNumber?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date',
    example: '2027-03-01',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(ISO_DATE, {
    message: 'El vencimiento de la póliza tiene que ser AAAA-MM-DD',
  })
  policyExpiresAt?: string | null
}

export class CreateContractDto {
  @ApiProperty({
    description:
      'Propiedad a alquilar. Tiene que tener propietario (de ahí sale el del contrato) y no tener otro contrato activo.',
  })
  @IsUUID('all', { message: 'Elegí una propiedad' })
  propertyId: string

  @ApiProperty({ description: 'Inquilino titular, sin otro contrato activo.' })
  @IsUUID('all', { message: 'Elegí un inquilino' })
  renterId: string

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Garante. Si no viene, se toma el garante actual del inquilino; null para dejarlo sin garante.',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Elegí un garante' })
  guarantorId?: string | null

  @ApiProperty({ format: 'date', example: '2026-03-01' })
  @Matches(ISO_DATE, { message: 'La fecha de inicio tiene que ser AAAA-MM-DD' })
  startDate: string

  @ApiProperty({ format: 'date', example: '2028-02-29' })
  @Matches(ISO_DATE, { message: 'La fecha de fin tiene que ser AAAA-MM-DD' })
  endDate: string

  @IsMoneyAmount()
  initialRent: string

  @ApiProperty({ enum: Currency, example: Currency.ARS })
  @IsEnum(Currency, { message: 'La moneda no es válida' })
  currency: Currency

  @ApiProperty({ enum: RentUpdateType, example: RentUpdateType.ICL })
  @IsEnum(RentUpdateType, { message: 'El tipo de actualización no es válido' })
  rentUpdateType: RentUpdateType

  @ApiProperty({
    enum: RentUpdateFrequency,
    example: RentUpdateFrequency.QUARTERLY,
  })
  @IsEnum(RentUpdateFrequency, { message: 'La frecuencia no es válida' })
  rentUpdateFrequency: RentUpdateFrequency

  @IsMoneyAmount()
  deposit: string

  @ApiPropertyOptional({
    enum: Currency,
    description:
      'Moneda en que se recibió el depósito. Default: la del contrato.',
  })
  @IsOptional()
  @IsEnum(Currency, { message: 'La moneda del depósito no es válida' })
  depositCurrency?: Currency

  @ApiPropertyOptional({
    enum: DepositReturnMode,
    description: 'Cómo se devuelve el depósito al terminar. Default FIXED.',
  })
  @IsOptional()
  @IsEnum(DepositReturnMode, {
    message: 'El modo de devolución del depósito no es válido',
  })
  depositReturnMode?: DepositReturnMode

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '10.00',
    description:
      'Con rentUpdateType FIXED: el % que se aplica solo en cada aumento. Sin él, el aumento se carga a mano.',
  })
  @IsOptional()
  @Matches(PERCENTAGE, {
    message:
      'fixedIncreasePercentage debe ser un porcentaje con hasta 2 decimales',
  })
  fixedIncreasePercentage?: string | null

  @ApiProperty({ description: 'Si el contrato exige seguro de caución' })
  @IsBoolean()
  hasSurety: boolean

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 150 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(150)
  insurerName?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Obligatorio con caución: ahí va la alerta automática (RN-10).',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail({}, { message: 'El email de la aseguradora no es válido' })
  @MaxLength(255)
  insurerAlertEmail?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  policyNumber?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date',
    example: '2027-03-01',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(ISO_DATE, {
    message: 'El vencimiento de la póliza tiene que ser AAAA-MM-DD',
  })
  policyExpiresAt?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null

  @ApiPropertyOptional({
    enum: CollectionMode,
    description: 'Quién cobra el alquiler. Default AGENCY.',
  })
  @IsOptional()
  @IsEnum(CollectionMode, { message: 'La modalidad de cobro no es válida' })
  collectionMode?: CollectionMode

  @ApiPropertyOptional({
    enum: FeeMode,
    description: 'Cómo cobra sus honorarios la inmobiliaria. Default DEDUCTED.',
  })
  @IsOptional()
  @IsEnum(FeeMode, { message: 'La modalidad de honorarios no es válida' })
  feeMode?: FeeMode

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '25000.00',
    description: 'Importe fijo de honorarios; si viene, manda sobre el %.',
  })
  @IsOptional()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'feeAmount debe ser un monto con hasta 2 decimales',
  })
  feeAmount?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '5.00',
    description:
      'Punitorio diario en %. Si no viene, el de la inmobiliaria; si la inmobiliaria no fijó uno, es obligatorio (422).',
  })
  @IsOptional()
  @Matches(PERCENTAGE, {
    message: 'lateFeePercentage debe ser un porcentaje con hasta 2 decimales',
  })
  lateFeePercentage?: string | null

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 10,
    description:
      'Días del mes sin punitorio. Si no viene, los de la inmobiliaria.',
  })
  @IsOptional()
  @IsInt({ message: 'lateFeeGraceDays tiene que ser un entero' })
  @Min(0)
  lateFeeGraceDays?: number | null

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 11,
    description:
      'Día del mes desde el que corre el punitorio (1 a 31). Es la gracia dicha al revés (inicio = gracia + 1): no se combina con lateFeeGraceDays.',
  })
  @IsOptional()
  @IsInt({ message: 'lateFeeStartDay tiene que ser un entero' })
  @Min(1)
  @Max(31)
  lateFeeStartDay?: number | null
}

export class PartialSuretyDto extends PartialType(ContractSuretyInputDto) {}

/**
 * Una fila nueva de términos de cobro (D-70, sólo admin). Lo que no viene se
 * copia de la vigente; `feeAmount: null` vuelve al %; el punitorio en null
 * vuelve al de la inmobiliaria.
 */
export class ChangeBillingTermsDto extends ContractBillingTermsInputDto {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-11-01',
    description:
      'Desde cuándo rigen. Default hoy. No anterior a los términos vigentes y dentro del contrato.',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'effectiveFrom tiene que ser AAAA-MM-DD' })
  effectiveFrom?: string

  @ApiPropertyOptional({ type: String, example: '5.00', description: 'En %' })
  @IsOptional()
  @Matches(PERCENTAGE, {
    message: 'feePercentage debe ser un porcentaje con hasta 2 decimales',
  })
  feePercentage?: string

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null
}

/**
 * Sólo notas, caución y garante (D-55). Fechas, montos, partes y estado
 * cambian por un aumento, una rescisión o una renovación.
 */
export class UpdateContractDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Garante; null para sacarlo.',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Elegí un garante' })
  guarantorId?: string | null

  @ApiPropertyOptional({
    type: () => PartialSuretyDto,
    description: 'Se mezcla con la caución actual y se valida el resultado.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PartialSuretyDto)
  surety?: PartialSuretyDto

  @ApiPropertyOptional({ enum: DepositReturnMode })
  @IsOptional()
  @IsEnum(DepositReturnMode, {
    message: 'El modo de devolución del depósito no es válido',
  })
  depositReturnMode?: DepositReturnMode
}

/**
 * Renovación: todo lo que no venga se copia del contrato original; el
 * alquiler inicial, de su alquiler vigente.
 */
export class RenewContractDto extends PartialType(
  OmitType(CreateContractDto, [
    'propertyId',
    'renterId',
    'startDate',
    'endDate',
  ] as const),
) {
  @ApiPropertyOptional({
    description: 'Otro inquilino (spec 7). Si no viene, el mismo.',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Elegí un inquilino' })
  renterId?: string

  @ApiProperty({ format: 'date', example: '2028-03-01' })
  @Matches(ISO_DATE, { message: 'La fecha de inicio tiene que ser AAAA-MM-DD' })
  startDate: string

  @ApiProperty({ format: 'date', example: '2030-02-28' })
  @Matches(ISO_DATE, { message: 'La fecha de fin tiene que ser AAAA-MM-DD' })
  endDate: string
}

export class ApplyRentUpdateDto {
  @ApiPropertyOptional({
    type: String,
    example: '120000.00',
    description:
      'El nuevo alquiler a mano. Obligatorio en FIXED sin % fijo y en OTHER. Opcional en FIXED con % fijo (si no viene se calcula) y en ICL/IPC (ajuste manual autorizado; si no viene, sale del índice).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, {
    message:
      'newRent debe ser un monto con hasta 2 decimales (ej. "120000.00")',
  })
  newRent?: string

  @ApiPropertyOptional({
    maxLength: 500,
    example: 'Acuerdo con el inquilino por refacciones a su cargo',
    description:
      'Obligatorio cuando viene newRent (ajuste manual): por qué se ajusta a mano.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string

  @ApiPropertyOptional({
    maxLength: 150,
    example: 'Juan Pérez (propietario)',
    description:
      'Obligatorio cuando viene newRent (ajuste manual): quién lo autorizó.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  authorizedBy?: string
}

export class TerminateContractDto {
  @ApiProperty({
    format: 'date',
    example: '2026-12-01',
    description: 'Fecha en que el inquilino notificó la rescisión.',
  })
  @Matches(ISO_DATE, {
    message: 'La fecha de notificación tiene que ser AAAA-MM-DD',
  })
  notifiedAt: string
}

export class TerminationPreviewQueryDto extends TerminateContractDto {}

export class ListContractsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ContractStatus })
  @IsOptional()
  @IsEnum(ContractStatus, { message: 'El estado no es válido' })
  status?: ContractStatus

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  propertyId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  renterId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  ownerId?: string

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Sólo los activos que vencen dentro de los días de aviso de la inmobiliaria (hoy inclusive).',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'expiringSoon tiene que ser true o false' })
  expiringSoon?: boolean
}

// ------------------------------------------------------------ Respuestas

export class ContractPropertyRefDto {
  @ApiProperty() id: string
  @ApiProperty() address: string
}

export class ContractPartyRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class ContractSummaryDto {
  @ApiProperty() id: string
  @ApiProperty({ type: ContractPropertyRefDto, nullable: true })
  property: ContractPropertyRefDto | null
  @ApiProperty({ type: ContractPartyRefDto, nullable: true })
  owner: ContractPartyRefDto | null
  @ApiProperty({ type: ContractPartyRefDto, nullable: true })
  renter: ContractPartyRefDto | null
  @ApiProperty({ format: 'date' }) startDate: string
  @ApiProperty({ format: 'date', description: 'Último día, inclusive' })
  endDate: string
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty({
    type: String,
    example: '150333.33',
    description: 'Alquiler vigente: el último del historial',
  })
  currentRent: string
  @ApiProperty({ enum: ContractStatus }) status: ContractStatus
  @ApiProperty() hasSurety: boolean
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  policyExpiresAt: string | null
  @ApiProperty({ description: 'Hay caución y la póliza venció (RN-16)' })
  suretyExpired: boolean
  @ApiProperty({
    description: 'Activo y vence dentro de los días de aviso (RN-12)',
  })
  expiringSoon: boolean
  @ApiProperty({ description: 'Activo y con el fin ya pasado, sin renovar' })
  expired: boolean
  @ApiProperty({
    type: String,
    example: '5.00',
    description: 'En %: el vigente hoy según los términos de cobro',
  })
  feePercentage: string
  @ApiProperty({ enum: CollectionMode }) collectionMode: CollectionMode
  @ApiProperty({ enum: FeeMode }) feeMode: FeeMode
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class ContractBillingTermsDto {
  @ApiProperty() id: string
  @ApiProperty({ format: 'date' }) effectiveFrom: string
  @ApiProperty({ enum: CollectionMode }) collectionMode: CollectionMode
  @ApiProperty({ enum: FeeMode }) feeMode: FeeMode
  @ApiProperty({ type: String, example: '5.00' }) feePercentage: string
  @ApiProperty({ type: String, nullable: true }) feeAmount: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null = el de la inmobiliaria',
  })
  lateFeePercentage: string | null
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null = los de la inmobiliaria',
  })
  lateFeeGraceDays: number | null
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: ContractPartyRefDto, nullable: true })
  changedBy: ContractPartyRefDto | null
  @ApiProperty() createdAt: Date
}

/** Los vigentes hoy, con el punitorio ya resuelto contra la inmobiliaria. */
export class ContractCurrentBillingTermsDto extends ContractBillingTermsDto {
  @ApiProperty({ type: String, example: '5.00' })
  declare lateFeePercentage: string
  @ApiProperty({ type: Number, example: 10 })
  declare lateFeeGraceDays: number
  @ApiProperty({
    example: 11,
    description: 'Día del mes desde el que corre el punitorio (gracia + 1)',
  })
  lateFeeStartDay: number
  @ApiProperty({ description: 'El % de punitorio es el de la inmobiliaria' })
  inheritedLateFeePercentage: boolean
  @ApiProperty({ description: 'La gracia es la de la inmobiliaria' })
  inheritedLateFeeGraceDays: boolean
}

export class ContractSuretyDto {
  @ApiProperty({ type: String, nullable: true }) insurerName: string | null
  @ApiProperty({ type: String, nullable: true })
  insurerAlertEmail: string | null
  @ApiProperty({ type: String, nullable: true }) policyNumber: string | null
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  policyExpiresAt: string | null
  @ApiProperty({ type: String, nullable: true }) policyPdfUrl: string | null
  @ApiProperty() suretyExpired: boolean
}

export class ContractTerminationDto {
  @ApiProperty({ format: 'date' }) terminatedAt: string
  @ApiProperty({ format: 'date' }) notifiedAt: string
  @ApiProperty({ type: String, example: '130000.00' }) penalty: string
  @ApiProperty({ type: String, example: '1300000.00' }) futureRent: string
}

export class ContractRentUpdateDto {
  @ApiProperty() id: string
  @ApiProperty({ format: 'date' }) effectiveFrom: string
  @ApiProperty({ type: String, nullable: true }) previousRent: string | null
  @ApiProperty({ type: String }) newRent: string
  @ApiProperty({ enum: RentUpdateSource }) source: RentUpdateSource
  @ApiProperty({ type: String, nullable: true, enum: ['ICL', 'IPC'] })
  indexType: 'ICL' | 'IPC' | null
  @ApiProperty({ type: String, nullable: true, example: '2026-03' })
  indexFromPeriod: string | null
  @ApiProperty({ type: String, nullable: true, example: '2026-04' })
  indexToPeriod: string | null
  @ApiProperty({ type: String, nullable: true }) indexFromValue: string | null
  @ApiProperty({ type: String, nullable: true }) indexToValue: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'El % fijo aplicado (FIXED con fixedIncreasePercentage)',
  })
  fixedPercentage: string | null
  @ApiProperty({ type: String, nullable: true }) appliedById: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Ajuste manual: por qué se hizo (D-230)',
  })
  adjustmentReason: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Ajuste manual: quién lo autorizó (D-230)',
  })
  authorizedBy: string | null
  @ApiProperty() createdAt: Date
}

export class ContractTimelineDto {
  @ApiProperty() totalMonths: number
  @ApiProperty() elapsedMonths: number
  @ApiProperty({ minimum: 0, maximum: 100 }) progressPercent: number
}

export class ContractDetailDto extends ContractSummaryDto {
  @ApiProperty({ type: ContractPartyRefDto, nullable: true })
  guarantor: ContractPartyRefDto | null
  @ApiProperty({ type: String }) initialRent: string
  @ApiProperty({
    type: String,
    description: 'Lo recibido, en depositCurrency',
  })
  deposit: string
  @ApiProperty({ enum: Currency }) depositCurrency: Currency
  @ApiProperty({ enum: DepositReturnMode })
  depositReturnMode: DepositReturnMode
  @ApiProperty({ type: String, nullable: true, example: '10.00' })
  fixedIncreasePercentage: string | null
  @ApiProperty({ type: ContractCurrentBillingTermsDto })
  billingTerms: ContractCurrentBillingTermsDto
  @ApiProperty({
    type: [ContractBillingTermsDto],
    description: 'Historial de términos de cobro, del más nuevo al más viejo',
  })
  billingTermsHistory: ContractBillingTermsDto[]
  @ApiProperty({ enum: RentUpdateType }) rentUpdateType: RentUpdateType
  @ApiProperty({ enum: RentUpdateFrequency })
  rentUpdateFrequency: RentUpdateFrequency
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: String, nullable: true }) contractPdfUrl: string | null
  @ApiProperty({ type: ContractSuretyDto, nullable: true })
  surety: ContractSuretyDto | null
  @ApiProperty({ type: ContractTerminationDto, nullable: true })
  termination: ContractTerminationDto | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'PDF del cálculo de la rescisión (Fase 15)',
  })
  terminationPdfUrl: string | null
  @ApiProperty({ type: String, nullable: true }) renewedFromId: string | null
  @ApiProperty({
    type: [ContractRentUpdateDto],
    description: 'Historial del alquiler, del más reciente al más viejo',
  })
  rentUpdates: ContractRentUpdateDto[]
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date',
    description: 'Null si no está activo o termina antes del próximo aumento',
  })
  nextRentUpdateOn: string | null
  @ApiProperty({ type: ContractTimelineDto }) timeline: ContractTimelineDto
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: false },
    description:
      'Estado de cada mes. Siempre vacío hasta el motor de cobros (Fase 11).',
  })
  monthlyStatus: never[]
}

export class TerminationPreviewDto {
  @ApiProperty({ type: String }) currentRent: string
  @ApiProperty({ description: 'Meses enteros hasta el fin' })
  remainingMonths: number
  @ApiProperty({ description: 'Días sueltos después de esos meses' })
  remainingDays: number
  @ApiProperty({ description: 'Días totales desde la notificación al fin' })
  totalDays: number
  @ApiProperty({ type: String }) futureRent: string
  @ApiProperty({ type: String, description: '10 % del canon futuro (RN-09)' })
  penalty: string
}

export class TerminationResultDto extends ContractTerminationDto {
  @ApiProperty() remainingMonths: number
  @ApiProperty() remainingDays: number
  @ApiProperty({ type: ContractDetailDto }) contract: ContractDetailDto
}
