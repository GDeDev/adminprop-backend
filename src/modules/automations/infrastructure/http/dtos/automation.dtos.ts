import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator'

import { IndexType } from '@/modules/indices/public'
import {
  IndexFetchStatus,
  JobExecutionStatus,
  JobScope,
  JobTrigger,
} from '@/modules/automations/domain/job-catalog'
import { PaginationQueryDto } from '@/shared/pagination'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD = /^\d{4}-\d{2}$/

export class UserRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class JobExecutionDto {
  @ApiProperty() id: string
  @ApiProperty({ example: 'billing.arrears-notice' }) job: string
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null en los globales',
  })
  tenantId: string | null
  @ApiProperty({
    format: 'date',
    description: 'Día (hora local) de la corrida',
  })
  scheduledFor: string
  @ApiProperty() startedAt: Date
  @ApiProperty({ type: Date, nullable: true }) finishedAt: Date | null
  @ApiProperty({ enum: JobExecutionStatus }) status: JobExecutionStatus
  @ApiProperty({ description: 'Cuántas cosas tocó' }) affected: number
  @ApiProperty({
    type: String,
    nullable: true,
    example: '3 cuotas creadas, 12 ya existían',
  })
  summary: string | null
  @ApiProperty({ type: String, nullable: true }) error: string | null
  @ApiProperty({ enum: JobTrigger }) triggeredBy: JobTrigger
  @ApiProperty({ type: UserRefDto, nullable: true })
  triggeredByUser: UserRefDto | null
}

export class JobDto {
  @ApiProperty({ example: 'installments.generate' }) name: string
  @ApiProperty({ example: 'Generar cuotas del mes' }) title: string
  @ApiProperty() description: string
  @ApiProperty({ example: '10 0 * * *' }) cron: string
  @ApiProperty({ example: 'todos los días a las 00:10' }) cronLabel: string
  @ApiProperty({ enum: JobScope }) scope: JobScope
  @ApiProperty({
    type: JobExecutionDto,
    nullable: true,
    description: 'La del tenant, o la global en los jobs globales',
  })
  lastExecution: JobExecutionDto | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'ISO. Null si el disparo automático está apagado',
  })
  nextRunAt: string | null
}

export class ListExecutionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'billing.arrears-notice' })
  @IsOptional()
  @IsString()
  job?: string

  @ApiPropertyOptional({ enum: JobExecutionStatus })
  @IsOptional()
  @IsEnum(JobExecutionStatus, { message: 'El estado no es válido' })
  status?: JobExecutionStatus

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DATE, { message: 'from tiene que ser AAAA-MM-DD' })
  from?: string

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DATE, { message: 'to tiene que ser AAAA-MM-DD' })
  to?: string
}

export class RunJobDto {
  @ApiPropertyOptional({
    example: '2026-11',
    description:
      'Mes a procesar, si el job lo admite (generar cuotas, consolidados). Sin él, el de hoy.',
  })
  @IsOptional()
  @Matches(PERIOD, { message: 'period tiene que ser AAAA-MM' })
  period?: string
}

export class RunJobResultDto {
  @ApiProperty({ description: 'Se consulta en GET /automations/executions' })
  executionId: string
}

export class ListAlertsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Sólo los no leídos' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean
}

export class InternalAlertDto {
  @ApiProperty() id: string
  @ApiProperty({
    enum: [
      'RENT_UPDATE_PENDING',
      'INDEX_FETCH_FAILED',
      'INSTALLMENT_BASE_OUTDATED',
      'STATEMENT_PENDING',
      'DOCUMENT_FAILED',
      'JOB_FAILED',
      'PUBLIC_INQUIRY',
      'NOTIFICATION_FAILED',
      'EMAIL_BOUNCED',
      'COMPARABLES_SOURCE_STALE',
      'INQUIRY_FOLLOW_UP',
      'INQUIRY_ASSIGNED',
      'LISTING_CHANNEL_ERROR',
    ],
  })
  type: string
  @ApiProperty() title: string
  @ApiProperty() body: string
  @ApiProperty({ type: String, nullable: true, example: 'CONTRACT' })
  entityType: string | null
  @ApiProperty({ type: String, nullable: true }) entityId: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Ruta relativa del backoffice',
    example: '/contratos/00000000-0000-4000-8000-000000000000',
  })
  link: string | null
  @ApiProperty() createdAt: Date
  @ApiProperty({ type: Date, nullable: true }) readAt: Date | null
}

export class ReadAllAlertsResultDto {
  @ApiProperty() updated: number
}

export class IndexStatusDto {
  @ApiProperty({ enum: IndexType }) indexType: IndexType
  @ApiProperty({ type: String, nullable: true, example: '2026-09' })
  latestPeriod: string | null
  @ApiProperty({ type: String, nullable: true }) latestValue: string | null
  @ApiProperty({ type: String, nullable: true, example: 'bcra' })
  source: string | null
  @ApiProperty({ type: Date, nullable: true }) lastAttemptAt: Date | null
  @ApiProperty({ enum: IndexFetchStatus, nullable: true })
  lastAttemptStatus: IndexFetchStatus | null
  @ApiProperty({ type: String, nullable: true }) lastAttemptError: string | null
  @ApiProperty({ example: 'bcra-indec', description: 'bcra-indec | manual' })
  provider: string
}
