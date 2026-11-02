import { applyDecorators } from '@nestjs/common'
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger'
import { IsOptional, IsUUID, Matches } from 'class-validator'

import { ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginationMetaDto, PaginationQueryDto } from '@/shared/pagination'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

const schema = (name: string) => `#/components/schemas/${name}`

/**
 * Los portales reutilizan los DTOs de cobros, liquidaciones y contratos tal
 * cual (sólo cambian los datos que se enmascaran): se referencian por nombre
 * en vez de duplicar las clases, que son internas de cada módulo.
 */
export function ApiOkRef(name: string, description: string, many = false) {
  return ApiOkResponse({
    description,
    schema: {
      allOf: [
        {
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', nullable: true },
            data: many
              ? { type: 'array', items: { $ref: schema(name) } }
              : { $ref: schema(name) },
          },
        },
      ],
    },
  })
}

export function ApiPagedRef(name: string, description: string) {
  return applyDecorators(
    ApiExtraModels(ApiSuccessDto, PaginationMetaDto),
    ApiOkResponse({
      description,
      schema: {
        allOf: [
          {
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', nullable: true },
              data: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: schema(name) } },
                  pagination: { $ref: schema('PaginationMetaDto') },
                },
              },
            },
          },
        ],
      },
    }),
  )
}

// ------------------------------------------------------------ Consultas

export class PortalOwnerAccountQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'Mes del estado de cuenta; sin él, el mes en curso',
  })
  @IsOptional()
  @Matches(PERIOD, { message: 'El período tiene que ser AAAA-MM' })
  period?: string
}

export class PortalOwnerSettlementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'La propiedad no es válida' })
  propertyId?: string

  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(PERIOD, { message: 'El período tiene que ser AAAA-MM' })
  period?: string
}

export class PortalPdfQueryDto {
  @ApiPropertyOptional({
    enum: ['json'],
    description:
      'Con `json` devuelve `{ url }` en vez de redirigir (302): sirve para pedirlo con el token en el header y abrir la URL después',
  })
  @IsOptional()
  @Matches(/^json$/, { message: 'El formato sólo puede ser json' })
  format?: 'json'
}

// ------------------------------------------------------------ Respuestas

export class PortalBankAccountDto {
  @ApiProperty({ type: String, nullable: true }) holder: string | null
  @ApiProperty({ type: String, nullable: true }) bank: string | null
  @ApiProperty({ type: String, nullable: true }) cbu: string | null
  @ApiProperty({ type: String, nullable: true }) alias: string | null
}

export class PortalAgencyDto {
  @ApiProperty() name: string
  @ApiProperty() slug: string
  @ApiProperty({ type: String, nullable: true }) logoUrl: string | null
  @ApiProperty({ type: String, nullable: true, example: '#c2410c' })
  primaryColor: string | null
  @ApiProperty({ type: String, nullable: true }) phone: string | null
  @ApiProperty({ type: String, nullable: true }) email: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Sólo dígitos, con código de país',
    example: '5492215550000',
  })
  whatsapp: string | null
  @ApiProperty({ type: String, nullable: true }) address: string | null
  @ApiProperty({
    type: PortalBankAccountDto,
    nullable: true,
    description: 'Null hasta que la inmobiliaria cargue sus datos bancarios',
  })
  bankAccount: PortalBankAccountDto | null
}

export class PortalRenterMeDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
  @ApiProperty({ type: String, nullable: true }) email: string | null
  @ApiProperty({ type: String, nullable: true }) phone: string | null
  @ApiProperty({ type: PortalAgencyDto }) agency: PortalAgencyDto
}

class PortalContractPropertyDto {
  @ApiProperty() id: string
  @ApiProperty() address: string
  @ApiProperty({ type: String, nullable: true }) propertyType: string | null
}

class PortalGuarantorDto {
  @ApiProperty() fullName: string
}

class PortalSuretyDto {
  @ApiProperty() hasSurety: boolean
  @ApiProperty({ type: String, nullable: true }) policyExpiresAt: string | null
}

class PortalFeePaidByRenterDto {
  @ApiProperty({ example: '5.00' }) feePercentage: string
  @ApiProperty({ type: String, nullable: true }) feeAmount: string | null
}

export class PortalRenterContractDto {
  @ApiProperty() id: string
  @ApiProperty({ example: 'ACTIVE' }) status: string
  @ApiProperty({ type: PortalContractPropertyDto })
  property: PortalContractPropertyDto
  @ApiProperty({ example: '2026-01-01' }) startDate: string
  @ApiProperty({ example: '2027-12-31' }) endDate: string
  @ApiProperty({ example: '350000.00' }) currentRent: string
  @ApiProperty({ example: 'ARS' }) currency: string
  @ApiProperty({ example: 'ICL' }) rentUpdateType: string
  @ApiProperty({ example: 'QUARTERLY' }) rentUpdateFrequency: string
  @ApiProperty({ type: String, nullable: true }) nextRentUpdateOn: string | null
  @ApiProperty({ example: '350000.00' }) deposit: string
  @ApiProperty({ example: 'ARS' }) depositCurrency: string
  @ApiProperty({ example: 'NOMINAL' }) depositReturnMode: string
  @ApiProperty({ type: PortalGuarantorDto, nullable: true })
  guarantor: PortalGuarantorDto | null
  @ApiProperty({ type: PortalSuretyDto }) surety: PortalSuretyDto
  @ApiProperty({
    type: 'array',
    items: { $ref: schema('ContractServiceDto') },
    description: 'Sin las notas internas',
  })
  services: unknown[]
  @ApiProperty({ example: 'AGENCY' }) collectionMode: string
  @ApiProperty({
    type: PortalFeePaidByRenterDto,
    nullable: true,
    description:
      'Sólo con honorarios a cargo del inquilino por cuenta del propietario (A-38); en otro caso es null',
  })
  feePaidByRenter: PortalFeePaidByRenterDto | null
  @ApiProperty({ allOf: [{ $ref: schema('ContractTimelineDto') }] })
  timeline: unknown
}

class PortalContractRefDto {
  @ApiProperty() id: string
  @ApiProperty({ example: 'ACTIVE' }) status: string
}

class PortalPaymentInstructionsDto {
  @ApiProperty({
    enum: ['AGENCY', 'OWNER_DIRECT'],
    description:
      'AGENCY: se paga a la inmobiliaria (con sus datos bancarios); OWNER_DIRECT: se paga directamente al propietario',
  })
  kind: string
  @ApiProperty({ type: PortalBankAccountDto, nullable: true })
  bankAccount: PortalBankAccountDto | null
}

export class PortalRenterAccountDto {
  @ApiProperty({ type: PortalContractRefDto, nullable: true })
  contract: PortalContractRefDto | null
  @ApiProperty({
    nullable: true,
    allOf: [{ $ref: schema('InstallmentDetailDto') }],
    description:
      'La cuota del mes (o la última si el contrato terminó). Sin quién registró, confirmó o anuló, ni notas internas ni la liquidación al propietario',
  })
  currentInstallment: unknown
  @ApiProperty({
    type: 'array',
    items: { $ref: schema('MoneyByCurrencyDto') },
  })
  creditsAvailable: unknown[]
  @ApiProperty({ allOf: [{ $ref: schema('RenterArrearsDto') }] })
  arrears: unknown
  @ApiProperty({ type: PortalPaymentInstructionsDto })
  paymentInstructions: PortalPaymentInstructionsDto
}

export class PortalOwnerBankAccountDto {
  @ApiProperty({ type: String, nullable: true }) cbu: string | null
  @ApiProperty({ type: String, nullable: true }) alias: string | null
  @ApiProperty({ type: String, nullable: true }) bankName: string | null
  @ApiProperty({ type: String, nullable: true }) holder: string | null
}

export class PortalOwnerMeDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
  @ApiProperty({ type: String, nullable: true }) email: string | null
  @ApiProperty({
    type: PortalOwnerBankAccountDto,
    nullable: true,
    description: 'Su cuenta registrada, para que confirme que es correcta',
  })
  bankAccount: PortalOwnerBankAccountDto | null
  @ApiProperty({ enum: ['SUMMARY', 'RECEIPTS', 'BOTH'] })
  statementSendMode: string
  @ApiProperty({ type: PortalAgencyDto }) agency: PortalAgencyDto
}

class PortalOwnerPropertyContractDto {
  @ApiProperty() id: string
  @ApiProperty({ type: PortalGuarantorDto }) renter: PortalGuarantorDto
  @ApiProperty({ example: '2026-01-01' }) startDate: string
  @ApiProperty({ example: '2027-12-31' }) endDate: string
  @ApiProperty({ example: '350000.00' }) currentRent: string
  @ApiProperty({ example: 'ARS' }) currency: string
  @ApiProperty({ example: 'AGENCY' }) collectionMode: string
}

class PortalOwnerPropertyInstallmentDto {
  @ApiProperty() id: string
  @ApiProperty({ example: '2026-10' }) period: string
  @ApiProperty({ example: 'PENDING' }) status: string
  @ApiProperty({ example: '350000.00' }) totalDue: string
  @ApiProperty({ example: '0.00' }) paidTotal: string
}

export class PortalOwnerPropertyDto {
  @ApiProperty() id: string
  @ApiProperty() address: string
  @ApiProperty({ example: 'RENTED' }) status: string
  @ApiProperty({ type: PortalOwnerPropertyContractDto, nullable: true })
  contract: PortalOwnerPropertyContractDto | null
  @ApiProperty({
    type: PortalOwnerPropertyInstallmentDto,
    nullable: true,
    description: 'La cuota del mes en curso',
  })
  currentInstallment: PortalOwnerPropertyInstallmentDto | null
}

class PortalAccountPropertyRefDto {
  @ApiProperty() id: string
  @ApiProperty() address: string
}

class PortalOwnerAccountPropertyDto {
  @ApiProperty({ type: PortalAccountPropertyRefDto })
  property: PortalAccountPropertyRefDto
  @ApiProperty({ example: 'ARS' }) currency: string
  @ApiProperty({ example: '350000.00', description: 'Alquiler del mes' })
  accrued: string
  @ApiProperty({ example: '350000.00', description: 'Alquiler cobrado' })
  collected: string
  @ApiProperty({ example: '0.00', description: 'Alquiler pendiente' })
  pending: string
  @ApiProperty({ example: '0.00', description: 'Punitorio vigente' })
  lateFee: string
  @ApiProperty({
    type: 'array',
    items: { $ref: schema('SettlementSummaryDto') },
    description: 'Liquidaciones del mes (sólo confirmadas o transferidas)',
  })
  settlements: unknown[]
}

class PortalOwnerFeesDto {
  @ApiProperty({ example: 'ARS' }) currency: string
  @ApiProperty({ example: '17500.00' }) accrued: string
  @ApiProperty({ example: '17500.00' }) collected: string
  @ApiProperty({ example: '0.00' }) pending: string
}

class PortalOwnerTotalsDto {
  @ApiProperty({ example: 'ARS' }) currency: string
  @ApiProperty({ example: '350000.00' }) accrued: string
  @ApiProperty({ example: '350000.00' }) collected: string
  @ApiProperty({ example: '0.00' }) pending: string
  @ApiProperty({
    example: '332500.00',
    description: 'Neto de las liquidaciones del mes',
  })
  netSettled: string
  @ApiProperty({
    example: '332500.00',
    description: 'Lo transferido de esas liquidaciones',
  })
  transferred: string
}

export class PortalOwnerAccountDto {
  @ApiProperty({ example: '2026-10' }) period: string
  @ApiProperty({ type: [PortalOwnerAccountPropertyDto] })
  properties: PortalOwnerAccountPropertyDto[]
  @ApiProperty({
    type: [PortalOwnerFeesDto],
    description:
      'Su cuenta de honorarios con la inmobiliaria, acumulada (no sólo el mes)',
  })
  fees: PortalOwnerFeesDto[]
  @ApiProperty({ type: [PortalOwnerTotalsDto] })
  totals: PortalOwnerTotalsDto[]
}

export class PortalPdfUrlDto {
  @ApiProperty({ description: 'URL del PDF vigente' }) url: string
}
