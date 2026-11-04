import { Injectable } from '@nestjs/common'
import { JobExecution as JobExecutionRow, Prisma } from '@prisma/client'

import {
  ExecutionFilter,
  JobExecution,
  JobExecutionRepository,
  JobExecutionResult,
  NewJobExecution,
  PageArgs,
} from '@/modules/automations/domain/automations.ports'
import {
  JobExecutionStatus,
  JobTrigger,
} from '@/modules/automations/domain/job-catalog'
import { IsoDate, toIsoDate } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'

const toDateColumn = (value: IsoDate) => new Date(`${value}T00:00:00.000Z`)

/**
 * `job_executions` no tiene filtro de tenant (`tenantId` es opcional), así que
 * todas las lecturas por inmobiliaria filtran a mano: el tenant pedido o los
 * globales (`tenantId IS NULL`). Se escribe con el cliente normal: el modelo
 * no es auditable ni tiene tenant, y el cron corre fuera de un request.
 */
@Injectable()
export class JobExecutionRepositoryImpl extends JobExecutionRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewJobExecution): Promise<JobExecution> {
    const row = await this.prisma.db.jobExecution.create({
      data: {
        job: data.job,
        tenantId: data.tenantId,
        scheduledFor: toDateColumn(data.scheduledFor),
        triggeredBy: data.triggeredBy,
        triggeredByUserId: data.triggeredByUserId,
      },
    })
    return toDomain(row)
  }

  async createScheduled(
    data: NewJobExecution,
    slot: number,
  ): Promise<JobExecution | null> {
    // Prisma no expresa ON CONFLICT DO NOTHING: va en SQL. Sin objetivo de
    // conflicto, cualquier violación del único parcial cuenta como "ya existe".
    const rows = await this.prisma.db.$queryRaw<{ id: string }[]>`
      INSERT INTO job_executions
        (id, job, tenant_id, scheduled_for, triggered_by, triggered_by_user_id, slot)
      VALUES (
        gen_random_uuid(),
        ${data.job},
        ${data.tenantId}::uuid,
        ${toDateColumn(data.scheduledFor)}::date,
        ${data.triggeredBy}::"JobTrigger",
        ${data.triggeredByUserId}::uuid,
        ${slot}
      )
      ON CONFLICT DO NOTHING
      RETURNING id`
    if (rows.length === 0) return null
    return this.findById(rows[0].id)
  }

  async findById(id: string): Promise<JobExecution | null> {
    const row = await this.prisma.db.jobExecution.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  }

  async markRunning(id: string): Promise<JobExecution> {
    const row = await this.prisma.db.jobExecution.update({
      where: { id },
      data: {
        status: JobExecutionStatus.RUNNING,
        finishedAt: null,
        error: null,
      },
    })
    return toDomain(row)
  }

  async finish(id: string, result: JobExecutionResult): Promise<JobExecution> {
    const row = await this.prisma.db.jobExecution.update({
      where: { id },
      data: {
        status: result.status,
        affected: result.affected,
        summary: result.summary,
        error: result.error,
        details: (result.details ?? Prisma.DbNull) as
          Prisma.InputJsonValue | typeof Prisma.DbNull,
        finishedAt: new Date(),
      },
    })
    return toDomain(row)
  }

  async delete(id: string): Promise<void> {
    await this.prisma.db.jobExecution.delete({ where: { id } })
  }

  async list(
    tenantId: string,
    filter: ExecutionFilter,
    page: PageArgs,
  ): Promise<[JobExecution[], number]> {
    const where: Prisma.JobExecutionWhereInput = {
      OR: [{ tenantId }, { tenantId: null }],
      ...(filter.job ? { job: filter.job } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to
        ? {
            scheduledFor: {
              ...(filter.from ? { gte: toDateColumn(filter.from) } : {}),
              ...(filter.to ? { lte: toDateColumn(filter.to) } : {}),
            },
          }
        : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.db.jobExecution.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        ...page,
      }),
      this.prisma.db.jobExecution.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async lastByJob(tenantId: string): Promise<Map<string, JobExecution>> {
    // `distinct` de Prisma 6 se resuelve en memoria (traía todo el historial,
    // con summary y details, para quedarse con un registro por job). Los ids
    // salen de un DISTINCT ON en la base y después se leen sólo esas filas.
    const latest = await this.prisma.db.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (job) id
      FROM job_executions
      WHERE tenant_id = ${tenantId}::uuid OR tenant_id IS NULL
      ORDER BY job, started_at DESC, id DESC`
    const rows = await this.prisma.db.jobExecution.findMany({
      where: { id: { in: latest.map((row) => row.id) } },
    })
    return new Map(rows.map((row) => [row.job, toDomain(row)]))
  }

  async lastGlobal(job: string, take: number): Promise<JobExecution[]> {
    const rows = await this.prisma.db.jobExecution.findMany({
      where: { job, tenantId: null },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take,
    })
    return rows.map(toDomain)
  }

  async countScheduled(date: IsoDate): Promise<Map<string, number>> {
    const groups = await this.prisma.db.jobExecution.groupBy({
      by: ['job', 'tenantId'],
      where: {
        scheduledFor: toDateColumn(date),
        triggeredBy: JobTrigger.SCHEDULE,
      },
      _count: { _all: true },
    })
    return new Map(
      groups.map((g) => [`${g.job}|${g.tenantId ?? ''}`, g._count._all]),
    )
  }

  async findRecentRunning(
    job: string,
    tenantId: string | null,
    since: Date,
  ): Promise<JobExecution | null> {
    const row = await this.prisma.db.jobExecution.findFirst({
      where: {
        job,
        tenantId,
        status: JobExecutionStatus.RUNNING,
        startedAt: { gte: since },
      },
      orderBy: { startedAt: 'desc' },
    })
    return row ? toDomain(row) : null
  }
}

function toDomain(row: JobExecutionRow): JobExecution {
  return {
    id: row.id,
    job: row.job,
    tenantId: row.tenantId,
    scheduledFor: toIsoDate(row.scheduledFor),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: JobExecutionStatus[row.status],
    affected: row.affected,
    summary: row.summary,
    error: row.error,
    details: (row.details as Record<string, unknown> | null) ?? null,
    triggeredBy: JobTrigger[row.triggeredBy],
    triggeredByUserId: row.triggeredByUserId,
  }
}
