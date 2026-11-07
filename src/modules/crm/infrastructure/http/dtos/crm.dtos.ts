import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator'

import { PaginationQueryDto } from '@/shared/pagination'
import {
  ContactChannel,
  InquiryActivityType,
  InquirySource,
  InquiryStage,
  MANUAL_SOURCES,
  MAX_NOTE_LENGTH,
} from '../../../domain/inquiry'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

// -------------------------------------------------------------- Requests

export class CreateInquiryDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio' })
  @MaxLength(120)
  name: string

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(200)
  email?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  phone?: string

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  propertyId?: string

  @ApiProperty({ enum: MANUAL_SOURCES })
  @IsIn(MANUAL_SOURCES, { message: 'El origen no es válido' })
  source: InquirySource

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  assignedToId?: string
}

export class UpdateInquiryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string

  @ApiPropertyOptional({
    description: 'Vacío = borrarlo (si queda el teléfono)',
  })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== '')
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(200)
  email?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  phone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  propertyId?: string

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '2026-11-10',
    description: 'Fecha de seguimiento; null la quita',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'La fecha tiene que ser AAAA-MM-DD' })
  nextActionAt?: string | null
}

export class MoveInquiryDto {
  @ApiProperty({ enum: InquiryStage })
  @IsEnum(InquiryStage, { message: 'La columna no es válida' })
  stage: InquiryStage

  @ApiPropertyOptional({ description: 'Tarjeta que queda arriba' })
  @IsOptional()
  @IsUUID('all')
  beforeId?: string

  @ApiPropertyOptional({ description: 'Tarjeta que queda abajo' })
  @IsOptional()
  @IsUUID('all')
  afterId?: string

  @ApiPropertyOptional({ description: 'Obligatorio para CLOSED_LOST' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  lostReason?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  contractId?: string
}

export class AssignInquiryDto {
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsUUID('all')
  userId: string | null
}

export class AddInquiryNoteDto {
  @ApiProperty({ maxLength: MAX_NOTE_LENGTH })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'La nota no puede estar vacía' })
  @MaxLength(MAX_NOTE_LENGTH)
  body: string
}

export class ContactAttemptDto {
  @ApiProperty({ enum: ContactChannel })
  @IsEnum(ContactChannel, { message: 'El canal no es válido' })
  channel: ContactChannel
}

export class WhatsAppLinkQueryDto {
  @ApiPropertyOptional({ example: 'INQUIRY_FIRST_CONTACT' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  templateKey?: string
}

class InquiryFiltersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  assignedToId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  propertyId?: string

  @ApiPropertyOptional({ enum: InquirySource })
  @IsOptional()
  @IsEnum(InquirySource, { message: 'El origen no es válido' })
  source?: InquirySource

  @ApiPropertyOptional({ description: 'Busca en nombre, contacto y mensaje' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string

  @ApiPropertyOptional({ description: 'Sólo las sin asignar' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unassigned?: boolean
}

export class PipelineQueryDto extends InquiryFiltersDto {}

export class ListInquiriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InquiryStage })
  @IsOptional()
  @IsEnum(InquiryStage, { message: 'La columna no es válida' })
  stage?: InquiryStage

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  assignedToId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  propertyId?: string

  @ApiPropertyOptional({ enum: InquirySource })
  @IsOptional()
  @IsEnum(InquirySource, { message: 'El origen no es válido' })
  source?: InquirySource

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unassigned?: boolean
}

export class RangeQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-07',
    description: 'Default: hace 30 días',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'La fecha tiene que ser AAAA-MM-DD' })
  from?: string

  @ApiPropertyOptional({ example: '2026-11-05', description: 'Default: hoy' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'La fecha tiene que ser AAAA-MM-DD' })
  to?: string
}

// ------------------------------------------------------------- Responses

class InquiryPropertyRefDto {
  @ApiProperty() id: string
  @ApiProperty() address: string
}

class InquiryUserRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class InquiryCardDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty({ type: String, nullable: true }) email: string | null
  @ApiProperty({ type: String, nullable: true }) phone: string | null
  @ApiProperty({ description: 'Primeros 140 caracteres' }) message: string
  @ApiProperty({ enum: InquiryStage }) stage: InquiryStage
  @ApiProperty({ description: 'Decimal para ordenar dentro de la columna' })
  boardPosition: number
  @ApiProperty({ enum: InquirySource }) source: InquirySource
  @ApiProperty({ type: InquiryPropertyRefDto, nullable: true })
  property: InquiryPropertyRefDto | null
  @ApiProperty({ type: InquiryUserRefDto, nullable: true })
  assignedTo: InquiryUserRefDto | null
  @ApiProperty({ type: String, nullable: true, example: '2026-11-10' })
  nextActionAt: string | null
  @ApiProperty({ type: Date, nullable: true }) lastContactAt: Date | null
  @ApiProperty() createdAt: Date
  @ApiProperty() ageHours: number
  @ApiProperty() hasWhatsApp: boolean
}

export class InquiryActivityDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: InquiryActivityType }) type: InquiryActivityType
  @ApiProperty({ type: InquiryUserRefDto, nullable: true })
  author: InquiryUserRefDto | null
  @ApiProperty({ type: 'object', additionalProperties: true })
  payload: Record<string, unknown>
  @ApiProperty() createdAt: Date
}

export class InquiryDetailDto extends InquiryCardDto {
  @ApiProperty({ type: String, nullable: true }) lostReason: string | null
  @ApiProperty({ type: Date, nullable: true }) closedAt: Date | null
  @ApiProperty({ type: String, nullable: true }) contractId: string | null
  @ApiProperty({ type: [InquiryActivityDto] })
  activities: InquiryActivityDto[]
}

class PipelineColumnDto {
  @ApiProperty({ enum: InquiryStage }) stage: InquiryStage
  @ApiProperty() total: number
  @ApiProperty({ type: [InquiryCardDto], description: 'Hasta 50' })
  cards: InquiryCardDto[]
}

export class PipelineDto {
  @ApiProperty({ type: [PipelineColumnDto] }) columns: PipelineColumnDto[]
}

export class WhatsAppLinkDto {
  @ApiProperty({ type: String, nullable: true }) url: string | null
  @ApiProperty() message: string
}

export class CrmAssigneeDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
  @ApiProperty() role: string
}

const COUNTS = {
  type: 'object',
  additionalProperties: { type: 'number' },
} as const

class CrmTopPropertyDto {
  @ApiProperty() propertyId: string
  @ApiProperty() address: string
  @ApiProperty() inquiries: number
  @ApiProperty() views: number
}

export class CrmOverviewDto {
  @ApiProperty() openCount: number
  @ApiProperty(COUNTS) byStage: Record<InquiryStage, number>
  @ApiProperty(COUNTS) bySource: Record<InquirySource, number>
  @ApiProperty() unassignedCount: number
  @ApiProperty({ type: Number, nullable: true })
  averageFirstContactHours: number | null
  @ApiProperty({ type: String, nullable: true, example: '12.5' })
  conversionRate: string | null
  @ApiProperty({ type: [CrmTopPropertyDto] })
  topProperties: CrmTopPropertyDto[]
}

class DailyPointDto {
  @ApiProperty({ example: '2026-11-05' }) date: string
  @ApiProperty() views: number
  @ApiProperty() inquiries: number
}

export class PropertyInquiryAnalyticsDto {
  @ApiProperty() views: number
  @ApiProperty() inquiries: number
  @ApiProperty(COUNTS) byStage: Record<InquiryStage, number>
  @ApiProperty(COUNTS) bySource: Record<InquirySource, number>
  @ApiProperty({ type: String, nullable: true }) conversionRate: string | null
  @ApiProperty({ type: [DailyPointDto] }) daily: DailyPointDto[]
}
