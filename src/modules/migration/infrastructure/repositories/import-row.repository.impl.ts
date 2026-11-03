import { Injectable } from '@nestjs/common'
import { ImportRow as RowRecord, Prisma } from '@prisma/client'

import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  ImportRowChanges,
  ImportRowFilter,
  ImportRowRepository,
  RowCountGroup,
} from '../../domain/migration.ports'
import {
  IMPORT_ORDER,
  ImportEntity,
  ImportResolution,
  ImportRow,
  ImportRowStatus,
  NewImportRow,
  RowConflict,
  RowData,
  RowError,
} from '../../domain/migration.types'

/** Las filas se insertan de a tandas: un Excel de 5.000 filas no entra en una sola consulta. */
const INSERT_CHUNK = 500

@Injectable()
export class ImportRowRepositoryImpl extends ImportRowRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async insertMany(batchId: string, rows: NewImportRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await this.prisma.db.importRow.createMany({
        // Sin tenantId: lo completa la extensión (de ahí el cast).
        data: rows.slice(i, i + INSERT_CHUNK).map(
          (row) =>
            ({
              id: row.id,
              batchId,
              entity: row.entity,
              rowNumber: row.rowNumber,
              externalId: row.externalId,
              naturalKey: row.naturalKey,
              label: row.label,
              status: row.status,
              data: row.data as unknown as Prisma.InputJsonValue,
              errors: row.errors as unknown as Prisma.InputJsonValue,
              conflict: (row.conflict ??
                Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
              resolution: row.resolution,
              excluded: row.excluded,
              targetId: row.targetId,
              needsReview: row.needsReview,
            }) as Prisma.ImportRowCreateManyInput,
        ),
      })
    }
  }

  async deleteByBatch(batchId: string): Promise<void> {
    await this.prisma.db.importRow.deleteMany({ where: { batchId } })
  }

  async findById(batchId: string, id: string): Promise<ImportRow | null> {
    const row = await this.prisma.db.importRow.findFirst({
      where: { id, batchId },
    })
    return row ? toDomain(row) : null
  }

  async list(
    batchId: string,
    filter: ImportRowFilter,
    page: { skip: number; take: number },
  ): Promise<[ImportRow[], number]> {
    const where = whereOf(batchId, filter)
    // El orden de importación no es el del enum de Postgres: se trae todo el
    // lote ordenado por fila y se pagina en memoria (tope de 5.000 filas).
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.importRow.findMany({
        where,
        orderBy: [{ rowNumber: 'asc' }, { label: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.db.importRow.count({ where }),
    ])
    const sorted = sortByEntity(rows.map(toDomain))
    return [sorted.slice(page.skip, page.skip + page.take), total]
  }

  async listAll(batchId: string, entity?: ImportEntity): Promise<ImportRow[]> {
    const rows = await this.prisma.db.importRow.findMany({
      where: { batchId, ...(entity ? { entity } : {}) },
      orderBy: [{ rowNumber: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toDomain)
  }

  async update(id: string, changes: ImportRowChanges): Promise<ImportRow> {
    const { errors, conflict, ...rest } = changes
    const row = await this.prisma.db.importRow.update({
      where: { id },
      data: {
        ...rest,
        ...(errors !== undefined
          ? { errors: errors as unknown as Prisma.InputJsonValue }
          : {}),
        ...(conflict !== undefined
          ? {
              conflict: (conflict ??
                Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    })
    return toDomain(row)
  }

  async countGroups(batchId: string): Promise<RowCountGroup[]> {
    const groups = await this.prisma.db.importRow.groupBy({
      by: ['entity', 'status', 'needsReview'],
      where: { batchId },
      _count: { _all: true },
    })
    return groups.map((g) => ({
      entity: g.entity as ImportEntity,
      status: g.status as ImportRowStatus,
      needsReview: g.needsReview,
      count: g._count._all,
    }))
  }
}

function whereOf(
  batchId: string,
  filter: ImportRowFilter,
): Prisma.ImportRowWhereInput {
  return {
    batchId,
    ...(filter.entity ? { entity: filter.entity } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.needsReview !== undefined
      ? { needsReview: filter.needsReview }
      : {}),
  }
}

/** Estable: dentro de cada entidad conserva el orden de fila. */
function sortByEntity(rows: ImportRow[]): ImportRow[] {
  return [...rows].sort(
    (a, b) => IMPORT_ORDER.indexOf(a.entity) - IMPORT_ORDER.indexOf(b.entity),
  )
}

function toDomain(row: RowRecord): ImportRow {
  return {
    id: row.id,
    batchId: row.batchId,
    entity: row.entity as ImportEntity,
    rowNumber: row.rowNumber,
    externalId: row.externalId,
    naturalKey: row.naturalKey,
    label: row.label,
    status: row.status as ImportRowStatus,
    data: row.data as unknown as RowData,
    errors: (row.errors as unknown as RowError[]) ?? [],
    conflict: (row.conflict as unknown as RowConflict | null) ?? null,
    resolution: row.resolution as ImportResolution | null,
    excluded: row.excluded,
    targetId: row.targetId,
    needsReview: row.needsReview,
  }
}
