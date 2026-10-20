import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator'

import { PropertyStatus } from '@/modules/properties/public/properties.facade'
import { PaginationQueryDto } from '@/shared/pagination'

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/** Un string vacío en un campo opcional es "sin dato", no un error. */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value

export class BankAccountDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '0110599552000000123456',
    description: '22 dígitos. Se validan los dígitos verificadores.',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{22}$/, { message: 'El CBU tiene que tener 22 dígitos' })
  cbu?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(50)
  alias?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  bankName?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 150 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(150)
  holder?: string | null
}

export class CreateOwnerDto {
  @ApiProperty({ example: 'Juan', maxLength: 100 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  firstName: string

  @ApiProperty({ example: 'Pérez', maxLength: 100 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @MaxLength(100)
  lastName: string

  @ApiProperty({
    example: '20123456',
    description:
      'DNI o CUIT. Se aceptan puntos y guiones; se guarda sólo en dígitos.',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El DNI es obligatorio' })
  @MaxLength(15)
  nationalId: string

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  phone?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Hace falta para generarle acceso al portal.',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(255)
  email?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(200)
  address?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null

  @ApiPropertyOptional({ type: BankAccountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount?: BankAccountDto
}

/** Los datos bancarios se cambian por su propio endpoint (spec 3.5). */
export class UpdateOwnerDto extends PartialType(
  OmitType(CreateOwnerDto, ['bankAccount'] as const),
) {}

export class ListOwnersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Parte del nombre, del apellido o del DNI',
    example: 'perez',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  search?: string
}

export class CheckOwnerDataQueryDto {
  @ApiPropertyOptional({ example: '20123456' })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  nationalId?: string

  @ApiPropertyOptional({ example: '0110599552000000123456' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  cbu?: string

  @ApiPropertyOptional({ description: 'En una edición, el propio propietario' })
  @IsOptional()
  @IsUUID('all')
  excludeId?: string
}

// ------------------------------------------------------------ Respuestas

class BankAccountViewDto {
  @ApiProperty({ type: String, nullable: true }) cbu: string | null
  @ApiProperty({ type: String, nullable: true }) alias: string | null
  @ApiProperty({ type: String, nullable: true }) bankName: string | null
  @ApiProperty({ type: String, nullable: true }) holder: string | null
}

class OwnerPropertyDto {
  @ApiProperty() id: string
  @ApiProperty() address: string
  @ApiProperty({ enum: PropertyStatus }) status: PropertyStatus
  @ApiProperty({ type: String, nullable: true }) mainPhotoUrl: string | null
}

export class OwnerSummaryDto {
  @ApiProperty() id: string
  @ApiProperty() firstName: string
  @ApiProperty() lastName: string
  @ApiProperty() fullName: string
  @ApiProperty() nationalId: string
  @ApiProperty({ type: String, nullable: true }) phone: string | null
  @ApiProperty({ type: String, nullable: true }) email: string | null
  @ApiProperty({ description: 'Propiedades a cargo, en cualquier estado' })
  propertyCount: number
  @ApiProperty({
    description:
      'Las que cuentan para el honorario reducido. Hasta la Fase 9, las alquiladas.',
  })
  activePropertyCount: number
  @ApiProperty({ description: 'Honorario reducido (RN-07), calculado' })
  reducedFee: boolean
  @ApiProperty() hasPortalAccess: boolean
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class OwnerDetailDto extends OwnerSummaryDto {
  @ApiProperty({ type: String, nullable: true }) address: string | null
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: BankAccountViewDto }) bankAccount: BankAccountViewDto
  @ApiProperty({ type: [OwnerPropertyDto] }) properties: OwnerPropertyDto[]
}

export class PortalCredentialsDto {
  @ApiProperty() userId: string
  @ApiProperty({ description: 'Usuario del portal' }) email: string
  @ApiProperty({
    description: 'Se muestra una sola vez: no se puede recuperar',
  })
  password: string
}

class OwnerRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class OwnerDataCheckDto {
  @ApiProperty({ type: OwnerRefDto, nullable: true })
  nationalIdTakenBy: OwnerRefDto | null
  @ApiProperty({ type: [OwnerRefDto] }) cbuSharedWith: OwnerRefDto[]
}
