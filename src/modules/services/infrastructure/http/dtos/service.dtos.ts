import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator'

import {
  Currency,
  IncreaseFrequency,
  ServicePayer,
  ServiceScope,
  ServiceStatus,
} from '@/modules/services/domain/property-service'
import { PaginationQueryDto } from '@/shared/pagination'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Un string vacío en un campo opcional es "sin dato", no un error. */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value

export class CreateServiceDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Contrato al que pertenece. Sin contrato es un servicio de la propiedad, que sus contratos heredan.',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Elegí un contrato' })
  contractId?: string | null

  @ApiProperty({ description: 'Tipo de servicio del maestro (activo).' })
  @IsUUID('all', { message: 'Elegí un tipo de servicio' })
  serviceTypeId: string

  @ApiProperty({ enum: ServicePayer, example: ServicePayer.RENTER })
  @IsEnum(ServicePayer, { message: 'Indicá quién paga' })
  paidBy: ServicePayer

  @ApiProperty({ enum: Currency, example: Currency.ARS })
  @IsEnum(Currency, { message: 'La moneda no es válida' })
  currency: Currency

  @ApiProperty({
    description: 'Si tiene fecha de vencimiento (exige `dueDate`).',
  })
  @IsBoolean()
  hasDueDate: boolean

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date',
    example: '2026-11-10',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(ISO_DATE, { message: 'El vencimiento tiene que ser AAAA-MM-DD' })
  dueDate?: string | null

  @ApiProperty({
    description: 'Si tiene aumentos periódicos (exige `increaseFrequency`).',
  })
  @IsBoolean()
  hasIncrease: boolean

  @ApiPropertyOptional({
    enum: IncreaseFrequency,
    nullable: true,
    example: IncreaseFrequency.QUARTERLY,
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(IncreaseFrequency, { message: 'La frecuencia no es válida' })
  increaseFrequency?: IncreaseFrequency | null

  @ApiProperty({
    description:
      'Si la inmobiliaria gestiona el pago, o es sólo informativo (igual puede tener vencimiento).',
  })
  @IsBoolean()
  managedByAgency: boolean

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null
}

/** Todo menos la propiedad. Vencimiento y aumentos se validan sobre el resultado. */
export class UpdateServiceDto extends PartialType(CreateServiceDto) {}

export class ListPropertyServicesQueryDto {
  @ApiPropertyOptional({ description: 'Sólo los de ese contrato.' })
  @IsOptional()
  @IsUUID('all')
  contractId?: string
}

export class ListOverdueServicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  propertyId?: string
}

// ------------------------------------------------------------ Respuestas

export class ServiceTypeRefDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty() isActive: boolean
}

export class ServicePropertyRefDto {
  @ApiProperty() id: string
  @ApiProperty() address: string
}

export class PropertyServiceDto {
  @ApiProperty() id: string
  @ApiProperty() propertyId: string
  @ApiProperty({ type: String, nullable: true }) contractId: string | null
  @ApiProperty({ type: ServiceTypeRefDto, nullable: true })
  serviceType: ServiceTypeRefDto | null
  @ApiProperty({ enum: ServicePayer }) paidBy: ServicePayer
  @ApiProperty({ enum: Currency }) currency: Currency
  @ApiProperty() hasDueDate: boolean
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  dueDate: string | null
  @ApiProperty() hasIncrease: boolean
  @ApiProperty({ enum: IncreaseFrequency, nullable: true })
  increaseFrequency: IncreaseFrequency | null
  @ApiProperty() managedByAgency: boolean
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({
    enum: ServiceStatus,
    description:
      'Calculado al leer: vencido si la fecha de vencimiento ya pasó',
  })
  status: ServiceStatus
  @ApiProperty({ description: 'Días desde el vencimiento; 0 si está al día' })
  daysOverdue: number
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class ContractServiceDto extends PropertyServiceDto {
  @ApiProperty({
    enum: ServiceScope,
    description:
      'CONTRACT: cargado para este contrato; PROPERTY: heredado de la propiedad',
  })
  scope: ServiceScope
}

export class OverdueServiceDto extends PropertyServiceDto {
  @ApiProperty({ type: ServicePropertyRefDto }) property: ServicePropertyRefDto
}
