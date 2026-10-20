import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator'

import { GuaranteeType } from '@/modules/renters/domain/guarantor'
import { PaginationQueryDto } from '@/shared/pagination'
import { GuarantorRefDto, RenterRefDto } from './renter.dtos'

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/** Un string vacío en un campo opcional es "sin dato", no un error. */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value

export class CreateGuarantorDto {
  @ApiProperty({ example: 'Marta', maxLength: 100 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  firstName: string

  @ApiProperty({ example: 'Gómez', maxLength: 100 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @MaxLength(100)
  lastName: string

  @ApiProperty({
    example: '27999888',
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

  @ApiPropertyOptional({ type: String, nullable: true })
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

  @ApiProperty({
    enum: GuaranteeType,
    example: GuaranteeType.PROPERTY,
    description: 'Con qué responde: un inmueble o sus recibos de sueldo.',
  })
  @IsEnum(GuaranteeType, { message: 'El tipo de garantía no es válido' })
  guaranteeType: GuaranteeType

  @ApiProperty({
    maxLength: 5000,
    example: 'Calle 7 123, La Plata. Matrícula 12345.',
    description:
      'Texto libre, no vacío: dirección y datos registrales del inmueble, o empleador y sueldo aproximado.',
  })
  @IsString()
  @MaxLength(5000)
  guaranteeDetail: string

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null
}

export class UpdateGuarantorDto extends PartialType(CreateGuarantorDto) {}

export class ListGuarantorsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Parte del nombre, del apellido o del DNI',
    example: 'gomez',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  search?: string
}

export class CheckGuarantorDataQueryDto {
  @ApiPropertyOptional({ example: '27999888' })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  nationalId?: string

  @ApiPropertyOptional({ description: 'En una edición, el propio garante' })
  @IsOptional()
  @IsUUID('all')
  excludeId?: string
}

// ------------------------------------------------------------ Respuestas

export class GuarantorSummaryDto {
  @ApiProperty() id: string
  @ApiProperty() firstName: string
  @ApiProperty() lastName: string
  @ApiProperty() fullName: string
  @ApiProperty() nationalId: string
  @ApiProperty({ type: String, nullable: true }) phone: string | null
  @ApiProperty({ type: String, nullable: true }) email: string | null
  @ApiProperty({ enum: GuaranteeType }) guaranteeType: GuaranteeType
  @ApiProperty() guaranteeDetail: string
  @ApiProperty({ description: 'Inquilinos que garantiza' }) renterCount: number
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class GuarantorDetailDto extends GuarantorSummaryDto {
  @ApiProperty({ type: String, nullable: true }) address: string | null
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({
    type: [RenterRefDto],
    description: 'Inquilinos que garantiza',
  })
  renters: RenterRefDto[]
}

export class GuarantorDataCheckDto {
  @ApiProperty({ type: GuarantorRefDto, nullable: true })
  nationalIdTakenBy: GuarantorRefDto | null
}
