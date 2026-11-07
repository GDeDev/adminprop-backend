import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

import {
  ImportBatchStatus,
  ImportEntity,
  ImportResolution,
  ImportRowStatus,
  ImportSource,
} from '@/modules/migration/domain/migration.types'
import { PaginationQueryDto } from '@/shared/pagination'

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : value

// ------------------------------------------------------------------ Pedidos

export class AnalyzeTokkoDto {
  @ApiPropertyOptional({
    type: [String],
    example: ['Rent'],
    description: 'Tipos de operación a traer. Por defecto sólo alquiler.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  operationTypes?: string[]

  @ApiPropertyOptional({
    description: 'Para probar con pocas propiedades.',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number

  @ApiProperty({ description: 'Si también se traen las fotos al confirmar.' })
  @IsBoolean()
  includeAssets: boolean
}

export class UpdateImportRowDto {
  @ApiPropertyOptional({ description: 'Excluir la fila de la importación.' })
  @IsOptional()
  @IsBoolean()
  excluded?: boolean

  @ApiPropertyOptional({
    enum: ImportResolution,
    description: 'Cómo resolver el conflicto de esta fila.',
  })
  @IsOptional()
  @IsEnum(ImportResolution)
  resolution?: ImportResolution
}

export class ConfirmImportDto {
  @ApiPropertyOptional({ type: [String], description: 'Filas a dejar afuera.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  excludeRowIds?: string[]

  @ApiProperty({
    enum: ImportResolution,
    description:
      'Qué hacer con los conflictos sin resolución propia. Nunca se pisa un valor ya cargado.',
  })
  @IsEnum(ImportResolution)
  defaultConflictResolution: ImportResolution

  @ApiPropertyOptional({
    description:
      'Si se traen las fotos de Tokko (por defecto, lo pedido al analizar).',
  })
  @IsOptional()
  @IsBoolean()
  migrateAssets?: boolean
}

export class ListBatchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ImportSource })
  @IsOptional()
  @IsEnum(ImportSource)
  source?: ImportSource

  @ApiPropertyOptional({ enum: ImportBatchStatus })
  @IsOptional()
  @IsEnum(ImportBatchStatus)
  status?: ImportBatchStatus
}

export class ListRowsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ImportEntity })
  @IsOptional()
  @IsEnum(ImportEntity)
  entity?: ImportEntity

  @ApiPropertyOptional({ enum: ImportRowStatus })
  @IsOptional()
  @IsEnum(ImportRowStatus)
  status?: ImportRowStatus

  @ApiPropertyOptional({ description: 'Sólo las marcadas para revisar.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  needsReview?: boolean
}

// ---------------------------------------------------------------- Respuestas

export class StartMigrationResultDto {
  @ApiProperty() batchId: string
  @ApiProperty({ description: 'Se consulta en GET /jobs/:id/status.' })
  jobId: string
}

export class RetryAssetsResultDto {
  @ApiProperty() jobId: string
}

export class ImportEntityCountsDto {
  @ApiProperty() total: number
  @ApiProperty() valid: number
  @ApiProperty() errors: number
  @ApiProperty() conflicts: number
  @ApiProperty() imported: number
}

export class ImportCountsDto {
  @ApiProperty() total: number
  @ApiProperty() valid: number
  @ApiProperty() errors: number
  @ApiProperty() conflicts: number
  @ApiProperty() alreadyImported: number
  @ApiProperty() imported: number
  @ApiProperty() skipped: number
  @ApiProperty() failed: number
  @ApiProperty() needsReview: number
  @ApiProperty({
    type: 'object',
    additionalProperties: {
      $ref: '#/components/schemas/ImportEntityCountsDto',
    },
    description: 'Por entidad: OWNER, RENTER, GUARANTOR, PROPERTY, CONTRACT.',
  })
  byEntity: Record<ImportEntity, ImportEntityCountsDto>
}

export class ImportAuthorDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class ImportBatchSummaryDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: ImportSource }) source: ImportSource
  @ApiProperty({ enum: ImportBatchStatus }) status: ImportBatchStatus
  @ApiProperty({ type: String, nullable: true }) fileName: string | null
  @ApiProperty({ type: ImportAuthorDto }) createdBy: ImportAuthorDto
  @ApiProperty() createdAt: Date
  @ApiProperty({ type: Date, nullable: true }) confirmedAt: Date | null
  @ApiProperty({ type: ImportCountsDto }) counts: ImportCountsDto
}

export class ImportMastersCountDto {
  @ApiProperty() locations: number
  @ApiProperty() propertyTypes: number
  @ApiProperty() amenities: number
}

export class ImportAssetsDto {
  @ApiProperty() migrated: number
  @ApiProperty() failed: number
  @ApiProperty() pending: number
}

export class ImportBatchDetailDto extends ImportBatchSummaryDto {
  @ApiProperty({ type: [String] }) missingSheets: string[]
  @ApiProperty({ type: ImportMastersCountDto })
  mastersToCreate: ImportMastersCountDto
  @ApiProperty({ type: ImportMastersCountDto })
  mastersCreated: ImportMastersCountDto
  @ApiProperty({ type: ImportAssetsDto }) assets: ImportAssetsDto
  @ApiProperty({
    description: 'El lote está listo para revisar y tiene algo para importar.',
  })
  canConfirm: boolean
  @ApiProperty({ type: String, nullable: true })
  errorMessage: string | null
}

export class ImportRowErrorDto {
  @ApiProperty() field: string
  @ApiProperty() code: string
  @ApiProperty() message: string
}

export class ImportRowConflictDto {
  @ApiProperty() entityId: string
  @ApiProperty() reason: string
  @ApiProperty({ type: [String] }) differingFields: string[]
}

export class ImportRowDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: ImportEntity }) entity: ImportEntity
  @ApiProperty({ type: Number, nullable: true }) rowNumber: number | null
  @ApiProperty({ type: String, nullable: true }) externalId: string | null
  @ApiProperty({ description: 'Texto para identificar la fila.' })
  label: string
  @ApiProperty({ enum: ImportRowStatus }) status: ImportRowStatus
  @ApiProperty({ type: [ImportRowErrorDto] }) errors: ImportRowErrorDto[]
  @ApiProperty({ type: ImportRowConflictDto, nullable: true })
  conflict: ImportRowConflictDto | null
  @ApiProperty({ enum: ImportResolution, nullable: true })
  resolution: ImportResolution | null
  @ApiProperty() excluded: boolean
  @ApiProperty() needsReview: boolean
  @ApiProperty({ type: String, nullable: true }) targetId: string | null
}
