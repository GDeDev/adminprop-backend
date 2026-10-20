import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator'

import { ActiveFilter } from '@/modules/master-data/domain/catalog'
import { LocationLevel } from '@/modules/master-data/domain/location'

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

const ACTIVE_VALUES = ['true', 'false', 'all'] as const
type ActiveParam = (typeof ACTIVE_VALUES)[number]

export function toActiveFilter(value: ActiveParam | undefined): ActiveFilter {
  if (value === 'false') return 'inactive'
  if (value === 'all') return 'all'
  return 'active'
}

export class ListMasterDataQueryDto {
  @ApiPropertyOptional({
    enum: ACTIVE_VALUES,
    default: 'true',
    description:
      'true (por defecto): sólo activos, los de los selectores. false: sólo desactivados. all: todos.',
  })
  @IsOptional()
  @IsIn(ACTIVE_VALUES, { message: 'isActive tiene que ser true, false o all' })
  isActive?: ActiveParam
}

// ------------------------------------------------------------ Maestros planos

export class CatalogItemDto {
  @ApiProperty({ example: '3f8c1b1e-3a6f-4f2e-9a1c-6d9f2b7c4e11' })
  id: string

  @ApiProperty({ example: 'Departamento' })
  name: string

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Sólo amenities: nombre de ícono de lucide. En el resto, null.',
    example: null,
  })
  icon: string | null

  @ApiProperty({ example: true })
  isActive: boolean

  @ApiProperty({ example: '2026-09-19T12:00:00.000Z' })
  createdAt: Date

  @ApiProperty({ example: '2026-09-19T12:00:00.000Z' })
  updatedAt: Date
}

export class CreateCatalogItemDto {
  @ApiProperty({ example: 'Dúplex', maxLength: 120 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(120)
  name: string
}

export class UpdateCatalogItemDto extends PartialType(CreateCatalogItemDto) {}

export class CreateAmenityDto extends CreateCatalogItemDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Nombre de ícono de lucide en kebab-case ("waves", "car").',
    example: 'waves',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'El ícono tiene que ser un nombre en kebab-case, como "car"',
  })
  icon?: string | null
}

export class UpdateAmenityDto extends PartialType(CreateAmenityDto) {}

// ----------------------------------------------------------------- Ubicaciones

export class LocationDto {
  @ApiProperty({ example: '3f8c1b1e-3a6f-4f2e-9a1c-6d9f2b7c4e11' })
  id: string

  @ApiProperty({ enum: LocationLevel, example: LocationLevel.NEIGHBORHOOD })
  level: LocationLevel

  @ApiProperty({ example: 'Palermo' })
  name: string

  @ApiProperty({ type: String, nullable: true, example: null })
  parentId: string | null

  @ApiProperty({ example: true })
  isActive: boolean

  @ApiProperty({ example: '2026-09-19T12:00:00.000Z' })
  createdAt: Date

  @ApiProperty({ example: '2026-09-19T12:00:00.000Z' })
  updatedAt: Date
}

export class LocationNodeDto extends LocationDto {
  @ApiProperty({ type: () => [LocationNodeDto] })
  children: LocationNodeDto[]
}

export class ListLocationsQueryDto extends ListMasterDataQueryDto {
  @ApiPropertyOptional({ enum: LocationLevel })
  @IsOptional()
  @IsEnum(LocationLevel, { message: 'El nivel no es válido' })
  level?: LocationLevel

  @ApiPropertyOptional({
    description: 'Sólo las que están directamente dentro de esta ubicación',
  })
  @IsOptional()
  @IsUUID('all', { message: 'parentId tiene que ser un UUID' })
  parentId?: string
}

export class CreateLocationDto {
  @ApiProperty({ enum: LocationLevel, example: LocationLevel.NEIGHBORHOOD })
  @IsEnum(LocationLevel, { message: 'El nivel no es válido' })
  level: LocationLevel

  @ApiProperty({ example: 'Palermo', maxLength: 120 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(120)
  name: string

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Dónde está. Obligatorio salvo para un país (spec: un barrio sin padre es un 400).',
  })
  // Un país no lleva padre; cualquier otro nivel, sí.
  @ValidateIf((dto: CreateLocationDto) => dto.level !== LocationLevel.COUNTRY)
  @IsUUID('all', { message: 'Elegí dónde está esta ubicación' })
  parentId: string | null
}

export class RenameLocationDto {
  @ApiProperty({ example: 'Palermo Soho', maxLength: 120 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(120)
  name: string
}
