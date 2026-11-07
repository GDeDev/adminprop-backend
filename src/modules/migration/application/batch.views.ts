import { Injectable } from '@nestjs/common'

import { UsersFacade } from '@/modules/auth/public'
import {
  ImportAssetRepository,
  ImportRowRepository,
  RowCountGroup,
} from '../domain/migration.ports'
import {
  ImportAssetStatus,
  ImportBatch,
  ImportBatchStatus,
  ImportEntity,
  ImportResolution,
  ImportRow,
  ImportRowStatus,
  ImportSource,
  MastersCount,
  RowError,
} from '../domain/migration.types'

export interface EntityCountsView {
  total: number
  valid: number
  errors: number
  conflicts: number
  imported: number
}

export interface ImportCountsView {
  total: number
  valid: number
  errors: number
  conflicts: number
  alreadyImported: number
  imported: number
  skipped: number
  failed: number
  needsReview: number
  byEntity: Record<ImportEntity, EntityCountsView>
}

export interface ImportBatchSummaryView {
  id: string
  source: ImportSource
  status: ImportBatchStatus
  fileName: string | null
  createdBy: { id: string; fullName: string }
  createdAt: Date
  confirmedAt: Date | null
  counts: ImportCountsView
}

export interface ImportBatchDetailView extends ImportBatchSummaryView {
  missingSheets: string[]
  mastersToCreate: MastersCount
  mastersCreated: MastersCount
  assets: { migrated: number; failed: number; pending: number }
  canConfirm: boolean
  /** Por qué falló el lote (análisis o importación); null si no falló. */
  errorMessage: string | null
}

export interface ImportRowView {
  id: string
  entity: ImportEntity
  rowNumber: number | null
  externalId: string | null
  label: string
  status: ImportRowStatus
  errors: RowError[]
  conflict: {
    entityId: string
    reason: string
    differingFields: string[]
  } | null
  resolution: ImportResolution | null
  excluded: boolean
  needsReview: boolean
  targetId: string | null
}

const EMPTY_MASTERS: MastersCount = {
  locations: 0,
  propertyTypes: 0,
  amenities: 0,
}

function emptyCounts(): ImportCountsView {
  const entity = (): EntityCountsView => ({
    total: 0,
    valid: 0,
    errors: 0,
    conflicts: 0,
    imported: 0,
  })
  return {
    total: 0,
    valid: 0,
    errors: 0,
    conflicts: 0,
    alreadyImported: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    needsReview: 0,
    byEntity: {
      [ImportEntity.OWNER]: entity(),
      [ImportEntity.RENTER]: entity(),
      [ImportEntity.GUARANTOR]: entity(),
      [ImportEntity.PROPERTY]: entity(),
      [ImportEntity.CONTRACT]: entity(),
    },
  }
}

/** Los contadores del lote a partir de los grupos entidad/estado/revisión. */
export function countsFrom(groups: RowCountGroup[]): ImportCountsView {
  const counts = emptyCounts()
  for (const group of groups) {
    const by = counts.byEntity[group.entity]
    counts.total += group.count
    by.total += group.count
    if (group.needsReview) counts.needsReview += group.count
    switch (group.status) {
      case ImportRowStatus.VALID:
        counts.valid += group.count
        by.valid += group.count
        break
      case ImportRowStatus.ERROR:
        counts.errors += group.count
        by.errors += group.count
        break
      case ImportRowStatus.CONFLICT:
        counts.conflicts += group.count
        by.conflicts += group.count
        break
      case ImportRowStatus.ALREADY_IMPORTED:
        counts.alreadyImported += group.count
        break
      case ImportRowStatus.IMPORTED:
        counts.imported += group.count
        by.imported += group.count
        break
      case ImportRowStatus.SKIPPED:
        counts.skipped += group.count
        break
      case ImportRowStatus.FAILED:
        counts.failed += group.count
        break
    }
  }
  return counts
}

@Injectable()
export class ImportBatchViews {
  constructor(
    private readonly rows: ImportRowRepository,
    private readonly assets: ImportAssetRepository,
    private readonly users: UsersFacade,
  ) {}

  async summaries(batches: ImportBatch[]): Promise<ImportBatchSummaryView[]> {
    const authors = await this.users.describe(
      batches.flatMap((b) => b.createdById ?? []),
    )
    return Promise.all(
      batches.map(async (batch) =>
        this.summary(
          batch,
          countsFrom(await this.rows.countGroups(batch.id)),
          authors.get(batch.createdById ?? '')?.fullName,
        ),
      ),
    )
  }

  async detail(batch: ImportBatch): Promise<ImportBatchDetailView> {
    const [groups, assets, authors] = await Promise.all([
      this.rows.countGroups(batch.id),
      this.assets.countByStatus(batch.id),
      this.users.describe(batch.createdById ? [batch.createdById] : []),
    ])
    const counts = countsFrom(groups)
    return {
      ...this.summary(
        batch,
        counts,
        authors.get(batch.createdById ?? '')?.fullName,
      ),
      missingSheets: batch.summary?.missingSheets ?? [],
      mastersToCreate: batch.summary?.mastersToCreate ?? EMPTY_MASTERS,
      mastersCreated: batch.summary?.mastersCreated ?? EMPTY_MASTERS,
      assets: {
        migrated: assets[ImportAssetStatus.MIGRATED],
        failed: assets[ImportAssetStatus.FAILED],
        pending: assets[ImportAssetStatus.PENDING],
      },
      canConfirm:
        batch.status === ImportBatchStatus.READY &&
        counts.valid + counts.conflicts > 0,
      errorMessage: batch.errorMessage,
    }
  }

  row(row: ImportRow): ImportRowView {
    return {
      id: row.id,
      entity: row.entity,
      rowNumber: row.rowNumber,
      externalId: row.externalId,
      label: row.label,
      status: row.status,
      errors: row.errors,
      conflict: row.conflict
        ? {
            entityId: row.conflict.entityId,
            reason: row.conflict.reason,
            differingFields: row.conflict.differingFields,
          }
        : null,
      resolution: row.resolution,
      excluded: row.excluded,
      needsReview: row.needsReview,
      targetId: row.targetId,
    }
  }

  private summary(
    batch: ImportBatch,
    counts: ImportCountsView,
    authorName: string | undefined,
  ): ImportBatchSummaryView {
    return {
      id: batch.id,
      source: batch.source,
      status: batch.status,
      fileName: batch.fileName,
      createdBy: {
        id: batch.createdById ?? '',
        fullName: authorName ?? 'Sistema',
      },
      createdAt: batch.createdAt,
      confirmedAt: batch.confirmedAt,
      counts,
    }
  }
}
