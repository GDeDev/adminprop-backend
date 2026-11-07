import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

import {
  MarketSource,
  ValuationConfidence,
  ValuationEngineKind,
} from '../../../domain/market'

/** Hasta 2 decimales, sin signo ni notación científica. */
const AREA_PATTERN = /^\d{1,6}(\.\d{1,2})?$/

export class AppraisePropertyDto {
  @ApiPropertyOptional({
    description:
      'Superficie en m² (decimal como string). Si la ficha no la tiene, se manda desde el formulario; sin ella se compara el precio absoluto.',
    example: '48.5',
  })
  @IsOptional()
  @IsString()
  @Matches(AREA_PATTERN, { message: 'La superficie no es válida' })
  areaM2?: string

  @ApiPropertyOptional({ minimum: 0, maximum: 20 })
  @IsOptional()
  @IsInt({ message: 'Los ambientes tienen que ser un entero' })
  @Min(0)
  @Max(20)
  bedrooms?: number

  @ApiPropertyOptional({
    type: [String],
    description: 'Textos libres; por defecto los de la propiedad.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  amenities?: string[]

  @ApiPropertyOptional({
    enum: ['ARS', 'USD'],
    description: 'Por defecto, la moneda de publicación de la propiedad.',
  })
  @IsOptional()
  @IsEnum(['ARS', 'USD'], { message: 'La moneda no es válida' })
  currency?: 'ARS' | 'USD'
}

export class MarketCoverageQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'La ubicación no es válida' })
  locationId: string
}

export class RefreshZoneDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'La ubicación no es válida' })
  locationId: string
}

export class ValuationRequesterDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class ValuationResultDto {
  @ApiProperty() id: string
  @ApiProperty() propertyId: string
  @ApiProperty({ enum: ['ARS', 'USD'] }) currency: string
  @ApiProperty({ example: '420000.00' }) minPrice: string
  @ApiProperty({ example: '510000.00' }) maxPrice: string
  @ApiProperty({ example: '455000.00' }) suggestedPrice: string
  @ApiProperty({
    example: '455000.00',
    description: 'A la centena más cercana en pesos y a la decena en dólares.',
  })
  suggestedPriceRounded: string
  @ApiProperty({ enum: ValuationConfidence }) confidence: string
  @ApiProperty() comparablesUsed: number
  @ApiProperty() comparablesDiscarded: number
  @ApiProperty({ example: 'Palermo, CABA' }) zoneLabel: string
  @ApiProperty() zoneWidened: boolean
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  oldestComparableAt: string | null
  @ApiProperty() justification: string
  @ApiProperty({ enum: ValuationEngineKind }) engine: string
  @ApiProperty({ type: ValuationRequesterDto })
  requestedBy: ValuationRequesterDto
  @ApiProperty({ format: 'date-time' }) createdAt: string
  @ApiProperty({
    description:
      'true si es una tasación idéntica de las últimas 6 horas que se devolvió en vez de crear otra.',
  })
  reused: boolean
}

export class MarketSourceStatusDto {
  @ApiProperty({ enum: MarketSource }) source: string
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastIngestAt: string | null
  @ApiProperty({ enum: ['OK', 'STALE', 'BLOCKED', 'PARSE_ERROR', 'DISABLED'] })
  status: string
  @ApiProperty() activeComparables: number
}

export class MarketStatusDto {
  @ApiProperty({ type: [MarketSourceStatusDto] })
  sources: MarketSourceStatusDto[]
  @ApiProperty() maxAgeDays: number
}

export class MarketCoverageDto {
  @ApiProperty({ example: 'Palermo, CABA' }) zoneLabel: string
  @ApiProperty() activeComparables: number
  @ApiProperty() enoughData: boolean
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastRefreshedAt: string | null
}

export class RefreshZoneResultDto {
  @ApiProperty({ description: 'Se consulta con GET /jobs/:id/status' })
  jobId: string
}
