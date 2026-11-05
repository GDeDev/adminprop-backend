import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

/** Un string vacío en un campo opcional es "sin dato", no un error. */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value

const nullable = (
  description: string,
  extra: { example?: string; maxLength?: number } = {},
) =>
  ApiPropertyOptional({ type: String, nullable: true, description, ...extra })

/** Todos opcionales: lo que no viene no se toca, `null` (o vacío) borra el dato. */
export class UpdateTenantSettingsDto {
  @nullable('Color de marca en hex (#rrggbb)', { example: '#1f4e79' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'El color tiene que ser un hex #rrggbb',
  })
  primaryColor?: string | null

  @nullable('Razón social', { maxLength: 200 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(200)
  legalName?: string | null

  @nullable('CUIT', { example: '30-12345678-9', maxLength: 20 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(20)
  taxId?: string | null

  @nullable('Domicilio comercial', { maxLength: 250 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(250)
  address?: string | null

  @nullable('Teléfono', { maxLength: 40 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  phone?: string | null

  @nullable('Email de contacto', { maxLength: 255 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail()
  @MaxLength(255)
  email?: string | null

  @nullable('WhatsApp: sólo dígitos con código de país', {
    example: '5491122334455',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{8,15}$/, {
    message: 'El WhatsApp tiene que ser sólo dígitos, con código de país',
  })
  whatsapp?: string | null

  @nullable('Titular de la cuenta bancaria', { maxLength: 150 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(150)
  bankAccountHolder?: string | null

  @nullable('Banco', { maxLength: 100 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  bankName?: string | null

  @nullable('CBU (22 dígitos)', { example: '0110599552000000123456' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{22}$/, { message: 'El CBU tiene que tener 22 dígitos' })
  bankCbu?: string | null

  @nullable('Alias', { maxLength: 60 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  bankAlias?: string | null

  @nullable('Leyenda al pie de los PDFs', { maxLength: 500 })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  documentFooter?: string | null

  @ApiPropertyOptional({
    type: String,
    example: '0.50',
    description:
      'Punitorio diario por defecto, en %. Lo heredan los contratos que no fijan el suyo; no puede quedar vacío una vez fijado (0 = sin punitorio).',
  })
  @IsOptional()
  @Matches(/^\d{1,3}(\.\d{1,2})?$/, {
    message:
      'dailyLateFeePercentage debe ser un porcentaje con hasta 2 decimales',
  })
  dailyLateFeePercentage?: string

  @ApiPropertyOptional({
    type: Number,
    example: 10,
    description:
      'Días del mes sin punitorio por defecto (el punitorio corre desde el día siguiente).',
  })
  @IsOptional()
  @IsInt({ message: 'paymentGraceDays tiene que ser un entero' })
  @Min(0)
  @Max(60)
  paymentGraceDays?: number

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Saldo a favor del inquilino: true = se aplica solo al generar la cuota; false (por defecto) = se aplica a mano o al registrar un pago.',
  })
  @IsOptional()
  @IsBoolean({
    message: 'autoApplyCreditOnGeneration tiene que ser true o false',
  })
  autoApplyCreditOnGeneration?: boolean
}

export class TenantSettingsDto {
  @ApiProperty() id: string
  @ApiProperty({ example: 'Inmobiliaria Demo' }) name: string
  @ApiProperty({ example: 'demo' }) slug: string
  @ApiProperty({ type: String, nullable: true }) logoUrl: string | null
  @ApiProperty({ type: String, nullable: true, example: '#1f4e79' })
  primaryColor: string | null
  @ApiProperty({ type: String, nullable: true }) legalName: string | null
  @ApiProperty({ type: String, nullable: true }) taxId: string | null
  @ApiProperty({ type: String, nullable: true }) address: string | null
  @ApiProperty({ type: String, nullable: true }) phone: string | null
  @ApiProperty({ type: String, nullable: true }) email: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Sólo dígitos con código de país',
  })
  whatsapp: string | null
  @ApiProperty({ type: String, nullable: true }) bankAccountHolder:
    string | null
  @ApiProperty({ type: String, nullable: true }) bankName: string | null
  @ApiProperty({ type: String, nullable: true }) bankCbu: string | null
  @ApiProperty({ type: String, nullable: true }) bankAlias: string | null
  @ApiProperty({ type: String, nullable: true }) documentFooter: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    example: '0.50',
    description: 'Null = sin punitorio por defecto: cada contrato fija el suyo',
  })
  dailyLateFeePercentage: string | null
  @ApiProperty({ example: 10 }) paymentGraceDays: number
  @ApiProperty({
    description:
      'El saldo a favor del inquilino se aplica solo al generar la cuota (si no, a mano)',
  })
  autoApplyCreditOnGeneration: boolean
  @ApiProperty({
    example: 11,
    description: 'Día del mes desde el que corre el punitorio (gracia + 1)',
  })
  lateFeeStartDay: number
  @ApiProperty({ description: 'Último número de recibo emitido' })
  receiptSequence: number
}

export const LOGO_BODY = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: {
      file: {
        type: 'string',
        format: 'binary',
        description: 'PNG, JPG, WebP o SVG de hasta 2 MB',
      },
    },
  },
}
