import { Injectable } from '@nestjs/common'
import { ImportBatch as BatchRow, Prisma } from '@prisma/client'

import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  ImportBatchChanges,
  ImportBatchFilter,
  ImportBatchRepository,
  NewImportBatch,
} from '../../domain/migration.ports'
import {
  BatchOptions,
  BatchSummary,
  ImportBatch,
  ImportBatchMode,
  ImportBatchStatus,
  ImportSource,
} from '../../domain/migration.types'

/** Siempre `prisma.db`: tenant y auditoría se aplican solos. */
@Injectable()
export class ImportBatchRepositoryImpl extends ImportBatchRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewImportBatch): Promise<ImportBatch> {
    // Sin tenantId ni autor: los completa la extensión (de ahí el cast).
    const row = await this.prisma.db.importBatch.create({
      data: {
        source: data.source,
        fileName: data.fileName,
        fileKey: data.fileKey,
        options: data.options as Prisma.InputJsonValue,
      } as Prisma.ImportBatchUncheckedCreateInput,
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<ImportBatch | null> {
    const row = await this.prisma.db.importBatch.findFirst({ where: { id } })
    return row ? toDomain(row) : null
  }

  async list(
    filter: ImportBatchFilter,
    page: { skip: number; take: number },
  ): Promise<[ImportBatch[], number]> {
    const where: Prisma.ImportBatchWhereInput = {
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    }
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.importBatch.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.importBatch.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async update(id: string, changes: ImportBatchChanges): Promise<ImportBatch> {
    const row = await this.prisma.db.importBatch.update({
      where: { id },
      data: toData(changes),
    })
    return toDomain(row)
  }

  async transition(
    id: string,
    from: ImportBatchStatus,
    changes: ImportBatchChanges,
  ): Promise<boolean> {
    const { count } = await this.prisma.db.importBatch.updateMany({
      where: { id, status: from },
      data: toData(changes),
    })
    return count === 1
  }

  async listStaleReady(before: Date): Promise<ImportBatch[]> {
    const rows = await this.prisma.db.importBatch.findMany({
      where: { status: ImportBatchStatus.READY, createdAt: { lt: before } },
    })
    return rows.map(toDomain)
  }
}

function toData(changes: ImportBatchChanges): Prisma.ImportBatchUpdateInput {
  const { summary, options, ...rest } = changes
  return {
    ...rest,
    ...(summary
      ? { summary: summary as unknown as Prisma.InputJsonValue }
      : {}),
    ...(options
      ? { options: options as unknown as Prisma.InputJsonValue }
      : {}),
  }
}

function toDomain(row: BatchRow): ImportBatch {
  return {
    id: row.id,
    source: row.source as ImportSource,
    mode: row.mode as ImportBatchMode,
    status: row.status as ImportBatchStatus,
    fileName: row.fileName,
    fileKey: row.fileKey,
    analysisJobId: row.analysisJobId,
    importJobId: row.importJobId,
    summary: (row.summary as BatchSummary | null) ?? null,
    options: (row.options as BatchOptions | null) ?? {},
    errorMessage: row.errorMessage,
    createdById: row.createdById,
    confirmedById: row.confirmedById,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
