import { ApiProperty } from '@nestjs/swagger'

import { AsyncJobStatus } from '@/modules/jobs/domain/async-job.entity'

export class AsyncJobStatusDto {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  id: string

  @ApiProperty({
    description: 'Tipo de trabajo',
    example: 'regenerate-pdfs',
  })
  type: string

  @ApiProperty({ enum: AsyncJobStatus, example: AsyncJobStatus.Processing })
  status: AsyncJobStatus

  @ApiProperty({ type: Number, nullable: true, example: 120 })
  totalItems: number | null

  @ApiProperty({
    description: 'Ítems terminados, bien o mal (incluye los fallidos)',
    example: 45,
  })
  processedItems: number

  @ApiProperty({ example: 2 })
  failedItems: number

  @ApiProperty({
    description: 'Avance de 0 a 100. Null si no se conoce el total.',
    type: Number,
    nullable: true,
    example: 37,
  })
  progress: number | null

  @ApiProperty({
    description: 'Detalle libre según el tipo de trabajo',
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  result: unknown

  @ApiProperty({ example: '2026-09-19T12:00:00.000Z' })
  startedAt: Date

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  finishedAt: Date | null
}
