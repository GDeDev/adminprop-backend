import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger'
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

import { GuaranteeType } from '@/modules/renters/domain/guarantor'
import { PaymentStatus } from '@/modules/renters/domain/renter'
import { PaginationQueryDto } from '@/shared/pagination'

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/** Un string vacío en un campo opcional es "sin dato", no un error. */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value

export class CreateRenterDto {
  @ApiProperty({ example: 'Iván', maxLength: 100 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  firstName: string

  @ApiProperty({ example: 'López', maxLength: 100 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @MaxLength(100)
  lastName: string

  @ApiProperty({
    example: '30123456',
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

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date',
    example: '2026-03-01',
    description: 'Fecha de ingreso, sin hora (AAAA-MM-DD).',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de ingreso tiene que ser AAAA-MM-DD',
  })
  moveInDate?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Garante (tiene que existir en la inmobiliaria). Opcional.',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Elegí un garante' })
  guarantorId?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null
}

export class UpdateRenterDto extends PartialType(CreateRenterDto) {}

export class ListRentersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Parte del nombre, del apellido o del DNI',
    example: 'lopez',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  search?: string

  @ApiPropertyOptional({
    enum: PaymentStatus,
    description:
      'Se valida pero todavía no filtra: el estado de pago llega con el motor de cobros (Fase 11).',
  })
  @IsOptional()
  @IsEnum(PaymentStatus, { message: 'El estado de pago no es válido' })
  paymentStatus?: PaymentStatus

  @ApiPropertyOptional({
    description:
      'Se valida pero todavía no filtra: inquilinos no conoce la propiedad de cada contrato (D-51).',
  })
  @IsOptional()
  @IsUUID('all')
  propertyId?: string
}

export class CheckRenterDataQueryDto {
  @ApiPropertyOptional({ example: '30123456' })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  nationalId?: string

  @ApiPropertyOptional({ description: 'En una edición, el propio inquilino' })
  @IsOptional()
  @IsUUID('all')
  excludeId?: string
}

// ------------------------------------------------------------ Respuestas

export class GuarantorRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class RenterGuarantorDto extends GuarantorRefDto {
  @ApiProperty() nationalId: string
  @ApiProperty({ type: String, nullable: true }) phone: string | null
  @ApiProperty({ type: String, nullable: true }) email: string | null
  @ApiProperty({ enum: GuaranteeType }) guaranteeType: GuaranteeType
  @ApiProperty() guaranteeDetail: string
}

export class RenterSummaryDto {
  @ApiProperty() id: string
  @ApiProperty() firstName: string
  @ApiProperty() lastName: string
  @ApiProperty() fullName: string
  @ApiProperty() nationalId: string
  @ApiProperty({ type: String, nullable: true }) phone: string | null
  @ApiProperty({ type: String, nullable: true }) email: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date',
    description: 'AAAA-MM-DD',
  })
  moveInDate: string | null
  @ApiProperty({ type: GuarantorRefDto, nullable: true })
  guarantor: GuarantorRefDto | null
  @ApiProperty() hasPortalAccess: boolean
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Contrato activo del que es titular, si lo hay',
  })
  activeContractId: string | null
  @ApiProperty({
    enum: PaymentStatus,
    nullable: true,
    description:
      'Estado de pago. Siempre null hasta el motor de cobros (Fase 11).',
  })
  paymentStatus: PaymentStatus | null
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class RenterActiveContractDto {
  @ApiProperty() id: string
}

/** La ficha: el garante viene expandido, no sólo como referencia. */
export class RenterDetailDto extends OmitType(RenterSummaryDto, [
  'guarantor',
] as const) {
  @ApiProperty({ type: String, nullable: true }) address: string | null
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: RenterGuarantorDto, nullable: true })
  guarantor: RenterGuarantorDto | null
  @ApiProperty({
    type: RenterActiveContractDto,
    nullable: true,
    description:
      'Contrato activo del que es titular. El detalle se pide a GET /contracts/:id.',
  })
  activeContract: RenterActiveContractDto | null
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: false },
    description:
      'Historial de pagos. Siempre vacío hasta el motor de cobros (Fase 11).',
  })
  payments: never[]
}

export class RenterRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class RenterDataCheckDto {
  @ApiProperty({ type: RenterRefDto, nullable: true })
  nationalIdTakenBy: RenterRefDto | null
}
