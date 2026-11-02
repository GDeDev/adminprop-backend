import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator'

import { PaginationQueryDto } from '@/shared/pagination'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_OR_DATE = /^\d{4}-\d{2}(-\d{2})?$/
const FORMATS = ['xlsx', 'csv', 'pdf'] as const
export type ReportFormatParam = (typeof FORMATS)[number]

// ------------------------------------------------------------- Consultas

/** `?format=` descarga el archivo en vez del JSON. */
export class ReportFormatQueryDto {
  @ApiPropertyOptional({
    enum: FORMATS,
    description:
      'Con formato, la respuesta es el archivo (Content-Disposition) en vez de JSON. Sin paginar.',
  })
  @IsOptional()
  @IsIn(FORMATS, { message: 'format tiene que ser xlsx, csv o pdf' })
  format?: ReportFormatParam
}

export class DashboardQueryDto {
  @ApiPropertyOptional({
    example: '2026-11',
    description: 'Default: el mes en curso',
  })
  @IsOptional()
  @Matches(PERIOD, { message: 'period tiene que ser AAAA-MM' })
  period?: string
}

export class RangeQueryDto extends ReportFormatQueryDto {
  @ApiPropertyOptional({
    example: '2026-05',
    description:
      'Mes (AAAA-MM, desde su primer día) o día (AAAA-MM-DD). Default: 6 meses atrás.',
  })
  @IsOptional()
  @Matches(MONTH_OR_DATE, {
    message: 'from tiene que ser AAAA-MM o AAAA-MM-DD',
  })
  from?: string

  @ApiPropertyOptional({
    example: '2026-10',
    description:
      'Mes (AAAA-MM, hasta su último día) o día (AAAA-MM-DD). Default: el mes en curso.',
  })
  @IsOptional()
  @Matches(MONTH_OR_DATE, { message: 'to tiene que ser AAAA-MM o AAAA-MM-DD' })
  to?: string
}

class PaymentsFiltersDto extends RangeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'ownerId no es un id válido' })
  ownerId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'propertyId no es un id válido' })
  propertyId?: string

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'renterId no es un id válido' })
  renterId?: string
}

export class PaymentsQueryDto extends IntersectionType(
  PaymentsFiltersDto,
  PaginationQueryDto,
) {}

export class ArrearsQueryDto extends ReportFormatQueryDto {
  @ApiPropertyOptional({ format: 'date', description: 'Default: hoy' })
  @IsOptional()
  @Matches(DATE, { message: 'asOf tiene que ser AAAA-MM-DD' })
  asOf?: string

  @ApiPropertyOptional({
    minimum: 0,
    default: 1,
    description: 'Sólo las cuotas con al menos esos días de atraso',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  minDays?: number
}

export class PropertiesQueryDto extends ReportFormatQueryDto {
  @ApiPropertyOptional({ enum: ['RENTED', 'AVAILABLE'] })
  @IsOptional()
  @IsIn(['RENTED', 'AVAILABLE'], {
    message: 'status tiene que ser RENTED o AVAILABLE',
  })
  status?: 'RENTED' | 'AVAILABLE'
}

export class ExpiringQueryDto extends ReportFormatQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 730,
    description: 'Default: los días de aviso de la inmobiliaria',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  withinDays?: number
}

export class ServicesQueryDto extends ReportFormatQueryDto {
  @ApiPropertyOptional({ enum: ['overdue', 'all'], default: 'overdue' })
  @IsOptional()
  @IsIn(['overdue', 'all'], { message: 'status tiene que ser overdue o all' })
  status?: 'overdue' | 'all'
}

// ------------------------------------------------------------ Respuestas

export class CurrencyAmountDto {
  @ApiProperty({ enum: ['ARS', 'USD'] })
  currency: string

  @ApiProperty({ example: '100000.00', description: 'Decimal como string' })
  amount: string
}

class ReportMetaDto {
  @ApiProperty({ format: 'date-time' })
  generatedAt: string

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
    description: 'Eco de los filtros pedidos',
  })
  filters: Record<string, string | null>
}

export class InstallmentBucketDto {
  @ApiProperty()
  count: number

  @ApiProperty({ type: [CurrencyAmountDto] })
  amounts: CurrencyAmountDto[]
}

class DashboardInstallmentsDto {
  @ApiProperty({ type: InstallmentBucketDto })
  paid: InstallmentBucketDto

  @ApiProperty({ type: InstallmentBucketDto })
  partial: InstallmentBucketDto

  @ApiProperty({ type: InstallmentBucketDto })
  pending: InstallmentBucketDto

  @ApiProperty({ type: InstallmentBucketDto })
  overdue: InstallmentBucketDto
}

class DashboardTodoDto {
  @ApiProperty()
  paymentsToConfirm: number

  @ApiProperty()
  settlementsToConfirm: number

  @ApiProperty()
  settlementsToTransfer: number

  @ApiProperty()
  openStatements: number

  @ApiProperty()
  pendingIncreases: number

  @ApiProperty()
  unreadAlerts: number
}

export class ExpiringContractRowDto {
  @ApiProperty({ format: 'uuid' })
  contractId: string

  @ApiProperty()
  propertyAddress: string

  @ApiProperty()
  renterName: string

  @ApiProperty({ format: 'date' })
  endDate: string

  @ApiProperty()
  daysLeft: number

  @ApiProperty()
  renewalInProgress: boolean
}

class DashboardHistoryDto {
  @ApiProperty({ example: '2026-10' })
  period: string

  @ApiProperty({ type: [CurrencyAmountDto] })
  accrued: CurrencyAmountDto[]

  @ApiProperty({ type: [CurrencyAmountDto] })
  collected: CurrencyAmountDto[]
}

export class DashboardReportDto extends ReportMetaDto {
  @ApiProperty({ example: '2026-11' })
  period: string

  @ApiProperty({ type: DashboardInstallmentsDto })
  installments: DashboardInstallmentsDto

  @ApiProperty({ type: [CurrencyAmountDto] })
  lateFeesAccrued: CurrencyAmountDto[]

  @ApiProperty({ type: [CurrencyAmountDto] })
  lateFeesCollected: CurrencyAmountDto[]

  @ApiProperty({ type: [CurrencyAmountDto] })
  feesAccrued: CurrencyAmountDto[]

  @ApiProperty({ type: DashboardTodoDto })
  todo: DashboardTodoDto

  @ApiProperty({ type: [ExpiringContractRowDto] })
  expiringContracts: ExpiringContractRowDto[]

  @ApiProperty({
    type: [DashboardHistoryDto],
    description: 'Últimos 6 meses, el más viejo primero',
  })
  history: DashboardHistoryDto[]
}

export class IncomeReportRowDto {
  @ApiProperty({ example: '2026-10' })
  period: string

  @ApiProperty({ enum: ['ARS', 'USD'] })
  currency: string

  @ApiProperty()
  rentCollected: string

  @ApiProperty()
  lateFeesCollected: string

  @ApiProperty()
  chargesCollected: string

  @ApiProperty()
  feesAccrued: string

  @ApiProperty()
  feesCollected: string

  @ApiProperty()
  netSettled: string

  @ApiProperty()
  netTransferred: string
}

export class IncomeReportDto extends ReportMetaDto {
  @ApiProperty({ type: [IncomeReportRowDto] })
  rows: IncomeReportRowDto[]
}

export class PaymentReportRowDto {
  @ApiProperty({ format: 'uuid' })
  paymentId: string

  @ApiProperty({ format: 'date' })
  paidAt: string

  @ApiProperty({ example: '2026-10' })
  period: string

  @ApiProperty()
  renterName: string

  @ApiProperty()
  propertyAddress: string

  @ApiProperty()
  ownerName: string

  @ApiProperty({ description: 'Lo entregado, en la moneda del pago' })
  amount: string

  @ApiProperty({ enum: ['ARS', 'USD'] })
  currency: string

  @ApiProperty({ example: 'TRANSFER' })
  method: string

  @ApiProperty({ enum: ['AGENCY', 'OWNER'] })
  receivedBy: string
}

export class ArrearsReportRowDto {
  @ApiProperty({ format: 'uuid' })
  renterId: string

  @ApiProperty()
  renterName: string

  @ApiProperty({ type: String, nullable: true })
  renterPhone: string | null

  @ApiProperty()
  propertyAddress: string

  @ApiProperty()
  ownerName: string

  @ApiProperty()
  overdueInstallments: number

  @ApiProperty()
  maxDaysOverdue: number

  @ApiProperty({ type: [CurrencyAmountDto] })
  balance: CurrencyAmountDto[]

  @ApiProperty({ type: [CurrencyAmountDto] })
  lateFee: CurrencyAmountDto[]
}

export class ArrearsReportDto extends ReportMetaDto {
  @ApiProperty({ type: [ArrearsReportRowDto] })
  rows: ArrearsReportRowDto[]

  @ApiProperty({ type: [CurrencyAmountDto] })
  totals: CurrencyAmountDto[]
}

export class PropertyReportRowDto {
  @ApiProperty({ format: 'uuid' })
  propertyId: string

  @ApiProperty()
  address: string

  @ApiProperty({ enum: ['RENTED', 'AVAILABLE', 'OTHER'] })
  status: string

  @ApiProperty({ type: String, nullable: true })
  renterName: string | null

  @ApiProperty({ type: CurrencyAmountDto, nullable: true })
  rent: CurrencyAmountDto | null

  @ApiProperty({ type: String, format: 'date', nullable: true })
  contractEndDate: string | null

  @ApiProperty({ type: Number, nullable: true })
  daysVacant: number | null
}

export class PropertiesReportDto extends ReportMetaDto {
  @ApiProperty({ type: [PropertyReportRowDto] })
  rows: PropertyReportRowDto[]
}

export class ExpiringContractsReportDto extends ReportMetaDto {
  @ApiProperty({ type: [ExpiringContractRowDto] })
  rows: ExpiringContractRowDto[]
}

export class ServiceReportRowDto {
  @ApiProperty({ format: 'uuid' })
  serviceId: string

  @ApiProperty({ format: 'uuid' })
  propertyId: string

  @ApiProperty()
  propertyAddress: string

  @ApiProperty()
  serviceName: string

  @ApiProperty()
  daysOverdue: number
}

export class ServicesReportDto extends ReportMetaDto {
  @ApiProperty({ type: [ServiceReportRowDto] })
  rows: ServiceReportRowDto[]
}
