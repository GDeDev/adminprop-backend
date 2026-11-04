import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator'

import { ListingCurrency } from '@/modules/properties/public'
import { PaginationQueryDto } from '@/shared/pagination'

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

const MONEY = /^\d{1,12}(\.\d{1,2})?$/
const MONEY_MESSAGE = 'El monto tiene que tener hasta 2 decimales (ej. 150000)'

// ------------------------------------------------------------- Pedidos

export class PublicListingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Ubicación (de `GET /filters`)' })
  @IsOptional()
  @IsUUID('all')
  locationId?: string

  @ApiPropertyOptional({ description: 'Tipo de propiedad (de `GET /filters`)' })
  @IsOptional()
  @IsUUID('all')
  propertyTypeId?: string

  @ApiPropertyOptional({
    example: '100000',
    description: 'Precio desde, string',
  })
  @IsOptional()
  @Matches(MONEY, { message: MONEY_MESSAGE })
  priceFrom?: string

  @ApiPropertyOptional({
    example: '300000',
    description: 'Precio hasta, string',
  })
  @IsOptional()
  @Matches(MONEY, { message: MONEY_MESSAGE })
  priceTo?: string

  @ApiPropertyOptional({
    enum: ListingCurrency,
    description: 'Moneda del rango; por defecto, la de la inmobiliaria',
  })
  @IsOptional()
  @IsEnum(ListingCurrency, { message: 'La moneda no es válida' })
  currency?: ListingCurrency
}

/** `PublicContactRequest` del contrato del portal. */
export class PublicContactDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(120)
  name: string

  @ApiProperty({ maxLength: 200 })
  @Transform(trimmed)
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(200)
  email: string

  @ApiPropertyOptional({ maxLength: 40, description: 'Puede ir vacío' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  phone?: string

  @ApiProperty({ maxLength: 2000 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El mensaje es obligatorio' })
  @MaxLength(2000)
  message: string

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Propiedad sobre la que se consulta; tiene que seguir disponible',
  })
  @IsOptional()
  @IsUUID('all')
  propertyId?: string | null

  @ApiPropertyOptional({
    description:
      'Honeypot: tiene que ir vacío. Con texto la consulta se descarta sin avisar.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string
}

// ----------------------------------------------------------- Respuestas

export class PublicPropertySummaryDto {
  @ApiProperty() id: string
  @ApiProperty({ description: 'Dirección corta' }) title: string
  @ApiProperty() address: string
  @ApiProperty() propertyType: string
  @ApiProperty({ type: String, nullable: true }) neighborhood: string | null
  @ApiProperty({ type: Number, nullable: true }) bedrooms: number | null
  @ApiProperty({ type: Number, nullable: true }) bathrooms: number | null
  @ApiProperty({ type: Number, nullable: true }) areaM2: number | null
  @ApiProperty({
    type: String,
    nullable: true,
    example: '150000.00',
    description: 'Null = "Consultar"',
  })
  price: string | null
  @ApiProperty({ enum: ListingCurrency, nullable: true })
  currency: ListingCurrency | null
  @ApiProperty({ type: String, nullable: true }) coverPhotoUrl: string | null
  @ApiProperty({ type: [String] }) amenities: string[]
}

class PublicPhotoDto {
  @ApiProperty() id: string
  @ApiProperty() url: string
}

class PublicFeatureDto {
  @ApiProperty() label: string
  @ApiProperty() value: string
}

export class PublicPropertyDetailDto extends PublicPropertySummaryDto {
  @ApiProperty({ type: String, nullable: true })
  publicDescription: string | null
  @ApiProperty({ type: [PublicPhotoDto] }) photos: PublicPhotoDto[]
  @ApiProperty({ description: 'Barrio, ciudad' }) location: string
  @ApiProperty({ type: [PublicFeatureDto] }) features: PublicFeatureDto[]
}

class PublicFilterOptionDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
}

export class PublicFiltersDto {
  @ApiProperty({ type: [PublicFilterOptionDto] })
  propertyTypes: PublicFilterOptionDto[]
  @ApiProperty({ type: [PublicFilterOptionDto] })
  locations: PublicFilterOptionDto[]
}

export class PublicContactResultDto {
  @ApiProperty() id: string
}
