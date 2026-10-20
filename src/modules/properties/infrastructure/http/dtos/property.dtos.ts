import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator'

import { PropertyStatus } from '@/modules/properties/domain/property'
import { PaginationQueryDto } from '@/shared/pagination'

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class CreatePropertyDto {
  @ApiProperty({ example: 'Av. Corrientes 1234, 5° B', maxLength: 200 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'La dirección es obligatoria' })
  @MaxLength(200)
  address: string

  @ApiProperty({ description: 'Localidad o barrio (maestro de ubicaciones)' })
  @IsUUID('all', { message: 'Elegí una ubicación' })
  locationId: string

  @ApiProperty({ description: 'Maestro de tipos de propiedad' })
  @IsUUID('all', { message: 'Elegí un tipo de propiedad' })
  propertyTypeId: string

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Propietario. Se puede asignar después.',
  })
  @IsOptional()
  @IsUUID('all')
  ownerId?: string | null

  @ApiPropertyOptional({ type: [String], default: [] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  amenityIds?: string[]

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Notas internas. Nunca se muestran en el portal.',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null
}

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {}

export class ChangePropertyStatusDto {
  @ApiProperty({ enum: PropertyStatus, example: PropertyStatus.MAINTENANCE })
  @IsEnum(PropertyStatus, { message: 'El estado no es válido' })
  status: PropertyStatus
}

export class ListPropertiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PropertyStatus })
  @IsOptional()
  @IsEnum(PropertyStatus, { message: 'El estado no es válido' })
  status?: PropertyStatus

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  ownerId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  propertyTypeId?: string

  @ApiPropertyOptional({
    description: 'Parte de la dirección, sin distinguir mayúsculas',
    example: 'corrientes',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  search?: string
}

// ------------------------------------------------------------ Respuestas

class MasterDataRefDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty() isActive: boolean
}

class AmenityRefDto extends MasterDataRefDto {
  @ApiProperty({ type: String, nullable: true, example: 'waves' })
  icon: string | null
}

class LocationRefDto extends MasterDataRefDto {
  @ApiProperty({ enum: ['COUNTRY', 'PROVINCE', 'CITY', 'NEIGHBORHOOD'] })
  level: string

  @ApiProperty({
    description: 'De lo específico a lo general, sin el país',
    example: 'Tolosa, La Plata, Buenos Aires',
  })
  path: string
}

class OwnerRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

class PropertyPhotoDto {
  @ApiProperty() id: string
  @ApiProperty() url: string
  @ApiProperty({ description: '0 es la principal' }) position: number
}

export class PropertySummaryDto {
  @ApiProperty() id: string
  @ApiProperty() address: string
  @ApiProperty({ enum: PropertyStatus }) status: PropertyStatus
  @ApiProperty({ type: String, nullable: true }) ownerId: string | null
  @ApiProperty({ type: OwnerRefDto, nullable: true }) owner: OwnerRefDto | null
  @ApiProperty({ type: LocationRefDto, nullable: true })
  location: LocationRefDto | null
  @ApiProperty({ type: MasterDataRefDto, nullable: true })
  propertyType: MasterDataRefDto | null
  @ApiProperty({ type: String, nullable: true }) mainPhotoUrl: string | null
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class PropertyDetailDto extends PropertySummaryDto {
  @ApiProperty() locationId: string
  @ApiProperty() propertyTypeId: string
  @ApiProperty({ type: [String] }) amenityIds: string[]
  @ApiProperty({ type: [AmenityRefDto] }) amenities: AmenityRefDto[]
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: [PropertyPhotoDto] }) photos: PropertyPhotoDto[]
}
