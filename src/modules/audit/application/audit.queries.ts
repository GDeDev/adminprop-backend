import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { ReportExporterPort } from '@/platform/exports/report-exporter.port'
import { Attachment, EXPORT_CONTENT_TYPES } from '@/shared/files/attachment'
import { instantOf, localMoment } from '@/shared/dates/zoned-time'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import {
  AuditActorKind,
  AuditAction,
  AuditFilter,
  AuditLogRepository,
  AUDIT_ENTITY_LABELS,
} from '../domain/audit'
import { AuditEntryNotFoundException } from '../domain/audit.exceptions'
import { AuditFacade } from '../public/audit.facade'
import {
  AuditCatalogView,
  AuditEntryDetailView,
  AuditEntryView,
  AuditViews,
} from './audit.views'

/** Filtros del request: fechas de calendario, en la hora de la inmobiliaria. */
export interface AuditQueryFilter {
  entity?: string
  entityId?: string
  action?: AuditAction
  userId?: string
  actorKind?: AuditActorKind
  from?: string
  to?: string
  search?: string
}

/** Tope de filas de una exportación; más que eso se filtra por fecha. */
export const MAX_EXPORT_ROWS = 5000
/** Cuántos cambios trae por defecto la pestaña "Historial" de una ficha. */
export const DEFAULT_HISTORY_LIMIT = 20
export const MAX_HISTORY_LIMIT = 100

export function toAuditFilter(query: AuditQueryFilter): AuditFilter {
  return {
    entity: query.entity,
    entityId: query.entityId,
    action: query.action,
    userId: query.userId,
    actorKind: query.actorKind,
    search: query.search,
    from: query.from ? instantOf(query.from, '00:00') : undefined,
    // Hasta el último milisegundo del día.
    to: query.to
      ? new Date(instantOf(query.to, '23:59').getTime() + 59_999)
      : undefined,
  }
}

export class ListAuditQuery {
  constructor(
    public readonly filter: AuditQueryFilter,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetAuditEntryQuery {
  constructor(public readonly id: string) {}
}

export class GetAuditCatalogQuery {}

export class ListEntityHistoryQuery {
  constructor(
    public readonly entity: string,
    public readonly entityId: string,
    public readonly limit: number | undefined,
  ) {}
}

export class ExportAuditQuery {
  constructor(
    public readonly filter: AuditQueryFilter,
    public readonly format: 'xlsx' | 'csv',
  ) {}
}

@QueryHandler(ListAuditQuery)
export class ListAuditHandler implements IQueryHandler<
  ListAuditQuery,
  PaginatedResult<AuditEntryView>
> {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly views: AuditViews,
  ) {}

  async execute(
    query: ListAuditQuery,
  ): Promise<PaginatedResult<AuditEntryView>> {
    const page = await paginateWith(query.page, (args) =>
      this.logs.page(toAuditFilter(query.filter), args),
    )
    return { ...page, data: await this.views.entries(page.data) }
  }
}

@QueryHandler(GetAuditEntryQuery)
export class GetAuditEntryHandler implements IQueryHandler<
  GetAuditEntryQuery,
  AuditEntryDetailView
> {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly views: AuditViews,
  ) {}

  async execute(query: GetAuditEntryQuery): Promise<AuditEntryDetailView> {
    const record = await this.logs.findById(query.id)
    if (!record) throw new AuditEntryNotFoundException()
    return this.views.detail(record)
  }
}

@QueryHandler(GetAuditCatalogQuery)
export class GetAuditCatalogHandler implements IQueryHandler<
  GetAuditCatalogQuery,
  AuditCatalogView
> {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly views: AuditViews,
  ) {}

  async execute(): Promise<AuditCatalogView> {
    return this.views.catalog(await this.logs.distinctEntities())
  }
}

@QueryHandler(ListEntityHistoryQuery)
export class ListEntityHistoryHandler implements IQueryHandler<
  ListEntityHistoryQuery,
  AuditEntryView[]
> {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly views: AuditViews,
  ) {}

  async execute(query: ListEntityHistoryQuery): Promise<AuditEntryView[]> {
    const limit = Math.min(
      Math.max(1, Math.trunc(query.limit ?? DEFAULT_HISTORY_LIMIT)),
      MAX_HISTORY_LIMIT,
    )
    return this.views.entries(
      await this.logs.historyOf(query.entity, query.entityId, limit),
    )
  }
}

@QueryHandler(ExportAuditQuery)
export class ExportAuditHandler implements IQueryHandler<
  ExportAuditQuery,
  Attachment
> {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly views: AuditViews,
    private readonly exporter: ReportExporterPort,
    private readonly audit: AuditFacade,
  ) {}

  async execute(query: ExportAuditQuery): Promise<Attachment> {
    const filter = toAuditFilter(query.filter)
    const entries = await this.views.entries(
      await this.logs.listForExport(filter, MAX_EXPORT_ROWS),
    )
    const today = localMoment().date

    const table = {
      title: 'Auditoría',
      meta: [
        ['Generado', `${today}`],
        ...Object.entries(query.filter)
          .filter(([, value]) => value !== undefined && value !== '')
          .map(([key, value]) => [key, String(value)] as [string, string]),
      ] as [string, string][],
      columns: [
        { header: 'Fecha y hora', width: 20 },
        { header: 'Usuario', width: 28 },
        { header: 'Actor', width: 16 },
        { header: 'Acción', width: 20 },
        { header: 'Entidad', width: 24 },
        { header: 'Detalle', width: 70 },
        { header: 'IP', width: 16 },
      ],
      rows: entries.map((entry) => {
        const at = localMoment(entry.createdAt)
        return [
          `${at.date} ${at.time}`,
          entry.userName ?? entry.userEmail,
          entry.actorKind,
          entry.action,
          AUDIT_ENTITY_LABELS[entry.entity] ?? entry.entity,
          entry.summary,
          entry.ip,
        ]
      }),
    }

    const buffer =
      query.format === 'csv'
        ? this.exporter.toCsv(table)
        : await this.exporter.toXlsx(table)

    await this.audit.record({
      action: 'EXPORT',
      entity: 'Audit',
      summary: `Exportó la auditoría (${entries.length} movimientos, ${query.format.toUpperCase()})`,
      changes: {
        format: { after: query.format },
        rows: { after: entries.length },
        filters: { after: query.filter },
      },
    })

    return {
      buffer,
      filename: `auditoria-${today}.${query.format}`,
      contentType: EXPORT_CONTENT_TYPES[query.format],
    }
  }
}
