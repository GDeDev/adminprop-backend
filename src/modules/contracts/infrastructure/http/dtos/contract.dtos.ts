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
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator'

import {
  ContractStatus,
  Currency,
  RentUpdateFrequency,
  RentUpdateSource,
  RentUpdateType,
} from '@/modules/contracts/domain/contract'
import { IsMoneyAmount } from '@/shared/money'
import { PaginationQueryDto } from '@/shared/pagination'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Un string vacío en un campo opcional es "sin dato", no un error. */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value

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
}

export class PartialSuretyDto extends PartialType(ContractSuretyInputDto) {}

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
      'Sólo para contratos FIXED u OTHER: el nuevo alquiler. Con ICL/IPC se ignora, sale del índice.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, {
    message:
      'newRent debe ser un monto con hasta 2 decimales (ej. "120000.00")',
  })
  newRent?: string
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
  @ApiProperty({ type: String, example: '5.00', description: 'En %' })
  feePercentage: string
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
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
  @ApiProperty({ type: String, nullable: true }) appliedById: string | null
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
    description: 'Estático: no sigue a los aumentos',
  })
  deposit: string
  @ApiProperty({ enum: RentUpdateType }) rentUpdateType: RentUpdateType
  @ApiProperty({ enum: RentUpdateFrequency })
  rentUpdateFrequency: RentUpdateFrequency
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: String, nullable: true }) contractPdfUrl: string | null
  @ApiProperty({ type: ContractSuretyDto, nullable: true })
  surety: ContractSuretyDto | null
  @ApiProperty({ type: ContractTerminationDto, nullable: true })
  termination: ContractTerminationDto | null
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
