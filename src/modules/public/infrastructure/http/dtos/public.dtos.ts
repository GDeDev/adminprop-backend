import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  Max,
  Min,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator'

import {
  ListingCurrency,
  ListingOperation,
  PUBLIC_PROPERTY_SORTS,
  PublicPropertySort,
} from '@/modules/properties/public'
import { PaginationQueryDto } from '@/shared/pagination'
import {
  PublicInquirySource,
  PublicInquiryStatus,
} from '../../../domain/public-inquiry'

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

  @ApiPropertyOptional({
    enum: ListingOperation,
    description: 'Venta (SALE) o alquiler (RENT)',
  })
  @IsOptional()
  @IsEnum(ListingOperation, { message: 'La operación no es válida' })
  operation?: ListingOperation

  @ApiPropertyOptional({ description: 'Dormitorios: este número o más' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  bedrooms?: number

  @ApiPropertyOptional({ description: 'Baños: este número o más' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  bathrooms?: number

  @ApiPropertyOptional({
    type: [String],
    description:
      'Sólo estas propiedades (hasta 12, separadas por coma). Las no disponibles no vuelven. Lo usa el sitio web para las destacadas a mano.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMaxSize(12)
  @IsUUID('all', { each: true })
  ids?: string[]

  @ApiPropertyOptional({
    enum: PUBLIC_PROPERTY_SORTS,
    default: 'recent',
    description:
      'Orden: `recent` (más nuevas primero), `price_asc` (menor precio primero) o `price_desc` (mayor primero). Las que no tienen precio ("Consultar") van siempre al final. El orden por precio compara montos nominales: combinarlo con `currency` para no mezclar ARS y USD.',
  })
  @IsOptional()
  @IsIn(PUBLIC_PROPERTY_SORTS, {
    message: 'El orden tiene que ser recent, price_asc o price_desc',
  })
  sort?: PublicPropertySort
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

export class ListInquiriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PublicInquiryStatus })
  @IsOptional()
  @IsEnum(PublicInquiryStatus, { message: 'El estado no es válido' })
  status?: PublicInquiryStatus

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  propertyId?: string
}

export class UpdateInquiryStatusDto {
  @ApiProperty({ enum: PublicInquiryStatus })
  @IsEnum(PublicInquiryStatus, { message: 'El estado no es válido' })
  status: PublicInquiryStatus
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
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Superficie total',
  })
  areaM2: number | null
  @ApiProperty({ enum: ListingOperation }) operation: ListingOperation
  @ApiProperty({ type: Number, nullable: true }) rooms: number | null
  @ApiProperty({ type: Number, nullable: true }) coveredAreaM2: number | null
  @ApiProperty({ type: Number, nullable: true }) ageYears: number | null
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

class InquiryPropertyDto {
  @ApiProperty() id: string
  @ApiProperty() address: string
}

export class PublicInquiryDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty() email: string
  @ApiProperty() phone: string
  @ApiProperty() message: string
  @ApiProperty({ type: String, nullable: true }) propertyId: string | null
  @ApiProperty({ type: InquiryPropertyDto, nullable: true })
  property: InquiryPropertyDto | null
  @ApiProperty({ enum: PublicInquiryStatus }) status: PublicInquiryStatus
  @ApiProperty({ enum: PublicInquirySource }) source: PublicInquirySource
  @ApiProperty() createdAt: Date
}
