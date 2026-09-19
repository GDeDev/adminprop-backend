import { Injectable } from '@nestjs/common'
import { AsyncJob as AsyncJobRow, Prisma } from '@prisma/client'

import {
  AsyncJob,
  AsyncJobStatus,
} from '@/modules/jobs/domain/async-job.entity'
import {
  AsyncJobRepository,
  CreateAsyncJobData,
} from '@/modules/jobs/domain/async-job.repository'
import { PrismaService } from '@/shared/prisma/prisma.service'

@Injectable()
export class AsyncJobRepositoryImpl extends AsyncJobRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: CreateAsyncJobData): Promise<AsyncJob> {
    // Sin tenantId: lo completa el filtro de tenant con el del contexto. El
    // cast es porque el tipo de Prisma no sabe que la extensión lo agrega.
    const row = await this.prisma.db.asyncJob.create({
      data: {
        type: data.type,
        startedById: data.startedById,
        totalItems: data.totalItems,
      } as Prisma.AsyncJobUncheckedCreateInput,
    })
    return this.toDomain(row)
  }

  async findById(id: string): Promise<AsyncJob | null> {
    const row = await this.prisma.db.asyncJob.findUnique({ where: { id } })
    return row ? this.toDomain(row) : null
  }

  async markProcessing(id: string): Promise<void> {
    await this.prisma.db.asyncJob.update({
      where: { id },
      data: { status: AsyncJobStatus.Processing },
    })
  }

  async recordItems(
    id: string,
    counts: { processed: number; failed: number },
  ): Promise<AsyncJob> {
    const row = await this.prisma.db.asyncJob.update({
      where: { id },
      data: {
        processedItems: { increment: counts.processed },
        failedItems: { increment: counts.failed },
      },
    })
    return this.toDomain(row)
  }

  async finish(
    id: string,
    status: AsyncJobStatus,
    result: unknown,
  ): Promise<void> {
    await this.prisma.db.asyncJob.update({
      where: { id },
      data: {
        status,
        result:
          result === undefined || result === null
            ? Prisma.DbNull
            : (result as Prisma.InputJsonValue),
        finishedAt: new Date(),
      },
    })
  }

  private toDomain(row: AsyncJobRow): AsyncJob {
    return {
      id: row.id,
      tenantId: row.tenantId,
      type: row.type,
      status: row.status as AsyncJobStatus,
      startedById: row.startedById,
      totalItems: row.totalItems,
      processedItems: row.processedItems,
      failedItems: row.failedItems,
      result: row.result,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    }
  }
}
