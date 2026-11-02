import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

import { PaginationQueryDto } from '@/shared/pagination'
import { AUDIT_ACTIONS } from '../../../application/audit.views'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ACTOR_KINDS = ['USER', 'SYSTEM', 'PORTAL_OWNER', 'PORTAL_RENTER'] as const

/** Filtros compartidos por el listado y la exportación. */
export class AuditFilterQueryDto {
  @ApiPropertyOptional({ example: 'Contract', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entity?: string

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string

  @ApiPropertyOptional({ enum: AUDIT_ACTIONS })
  @IsOptional()
  @IsIn(AUDIT_ACTIONS, { message: 'La acción no es válida' })
  action?: (typeof AUDIT_ACTIONS)[number]

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'userId no es un id válido' })
  userId?: string

  @ApiPropertyOptional({ enum: ACTOR_KINDS })
  @IsOptional()
  @IsIn(ACTOR_KINDS, { message: 'El actor no es válido' })
  actorKind?: (typeof ACTOR_KINDS)[number]

  @ApiPropertyOptional({
    format: 'date',
    description: 'Desde el inicio de ese día (hora de Buenos Aires)',
  })
  @IsOptional()
  @Matches(DATE, { message: 'from tiene que ser AAAA-MM-DD' })
  from?: string

  @ApiPropertyOptional({
    format: 'date',
    description: 'Hasta el fin de ese día (hora de Buenos Aires)',
  })
  @IsOptional()
  @Matches(DATE, { message: 'to tiene que ser AAAA-MM-DD' })
  to?: string

  @ApiPropertyOptional({
    description: 'Texto a buscar en el detalle, la entidad, su id y el email',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string
}

export class ListAuditQueryDto extends IntersectionType(
  AuditFilterQueryDto,
  PaginationQueryDto,
) {}

export class ExportAuditQueryDto extends AuditFilterQueryDto {
  @ApiProperty({ enum: ['xlsx', 'csv'] })
  @IsIn(['xlsx', 'csv'], { message: 'format tiene que ser xlsx o csv' })
  format: 'xlsx' | 'csv'
}

export class EntityHistoryQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}

export class AuditEntryDto {
  @ApiProperty({ format: 'uuid' })
  id: string

  @ApiProperty({ example: 'Contract' })
  entity: string

  @ApiProperty({ type: String, nullable: true })
  entityId: string | null

  @ApiProperty({ enum: AUDIT_ACTIONS })
  action: string

  @ApiProperty({
    example: 'Registró un pago de $ 100.000,00',
    description: 'Frase legible; la arma el servidor al leer',
  })
  summary: string

  @ApiProperty({ enum: ACTOR_KINDS })
  actorKind: string

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  userId: string | null

  @ApiProperty({ type: String, nullable: true })
  userEmail: string | null

  @ApiProperty({ type: String, nullable: true })
  userName: string | null

  @ApiProperty({ type: String, nullable: true })
  ip: string | null

  @ApiProperty({ format: 'date-time' })
  createdAt: Date
}

export class AuditChangeDto {
  @ApiProperty({ example: 'status' })
  field: string

  @ApiProperty({
    nullable: true,
    description: 'Valor anterior (cualquier tipo JSON)',
  })
  before: unknown

  @ApiProperty({
    nullable: true,
    description: 'Valor nuevo (cualquier tipo JSON)',
  })
  after: unknown

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Nombre legible cuando el valor es un id',
  })
  beforeLabel?: string | null

  @ApiPropertyOptional({ type: String, nullable: true })
  afterLabel?: string | null
}

export class AuditEntryDetailDto extends AuditEntryDto {
  @ApiProperty({ type: [AuditChangeDto] })
  changes: AuditChangeDto[]
}

export class AuditCatalogDto {
  @ApiProperty({ type: [String] })
  entities: string[]

  @ApiProperty({ enum: AUDIT_ACTIONS, isArray: true })
  actions: string[]
}
