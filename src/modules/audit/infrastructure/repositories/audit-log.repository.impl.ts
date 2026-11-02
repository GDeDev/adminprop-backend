import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { RequestContext } from '@/shared/context/request-context'
import { PageArgs } from '@/shared/pagination'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  AuditFilter,
  AuditLogRepository,
  AuditRecord,
} from '../../domain/audit'

/**
 * `audit_logs` no pasa por el filtro de tenant de Prisma (admite filas
 * globales y se escribe también sin contexto), así que acá el `tenantId` del
 * contexto va en **todos** los `where`, a mano. Sin tenant en el contexto no
 * se lee nada.
 */
@Injectable()
export class AuditLogRepositoryImpl extends AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async page(
    filter: AuditFilter,
    page: PageArgs,
  ): Promise<[AuditRecord[], number]> {
    const where = this.where(filter)
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...page,
      }),
      this.prisma.auditLog.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async listForExport(
    filter: AuditFilter,
    max: number,
  ): Promise<AuditRecord[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.where(filter),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: max,
    })
    return rows.map(toDomain)
  }

  async findById(id: string): Promise<AuditRecord | null> {
    const row = await this.prisma.auditLog.findFirst({
      where: this.where({}, { id }),
    })
    return row ? toDomain(row) : null
  }

  async historyOf(
    entity: string,
    entityId: string,
    limit: number,
  ): Promise<AuditRecord[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.where({ entity, entityId }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    })
    return rows.map(toDomain)
  }

  async distinctEntities(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.where({}),
      distinct: ['entity'],
      select: { entity: true },
    })
    return rows.map((row) => row.entity)
  }

  private where(
    filter: AuditFilter,
    extra: Prisma.AuditLogWhereInput = {},
  ): Prisma.AuditLogWhereInput {
    // Sin tenant, un id que nadie tiene: no devuelve filas.
    const tenantId =
      RequestContext.tenantId ?? '00000000-0000-0000-0000-000000000000'
    const search = filter.search?.trim()
    return {
      ...extra,
      tenantId,
      ...(filter.entity ? { entity: filter.entity } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.actorKind ? { actorKind: filter.actorKind } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { summary: { contains: search, mode: 'insensitive' } },
              { entityId: { contains: search, mode: 'insensitive' } },
              { entity: { contains: search, mode: 'insensitive' } },
              { userEmail: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
  }
}

function toDomain(row: {
  id: string
  entity: string
  entityId: string | null
  action: AuditRecord['action']
  summary: string | null
  changes: Prisma.JsonValue | null
  actorKind: AuditRecord['actorKind']
  userId: string | null
  userEmail: string | null
  ip: string | null
  createdAt: Date
}): AuditRecord {
  return {
    id: row.id,
    entity: row.entity,
    entityId: row.entityId,
    action: row.action,
    summary: row.summary,
    changes:
      row.changes &&
      typeof row.changes === 'object' &&
      !Array.isArray(row.changes)
        ? (row.changes as AuditRecord['changes'])
        : null,
    actorKind: row.actorKind,
    userId: row.userId,
    userEmail: row.userEmail,
    ip: row.ip,
    createdAt: row.createdAt,
  }
}
