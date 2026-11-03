import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  ImportAssetRepository,
  NewImportAsset,
} from '../../domain/migration.ports'
import {
  ImportAssetResult,
  ImportAssetStatus,
} from '../../domain/migration.types'

@Injectable()
export class ImportAssetRepositoryImpl extends ImportAssetRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async insertMany(batchId: string, items: NewImportAsset[]): Promise<void> {
    if (items.length === 0) return
    await this.prisma.db.importAssetResult.createMany({
      // Sin tenantId: lo completa la extensión (de ahí el cast).
      data: items.map(
        (item) =>
          ({
            ...item,
            sourceUrl: item.sourceUrl.slice(0, 1000),
            batchId,
          }) as Prisma.ImportAssetResultCreateManyInput,
      ),
    })
  }

  async list(
    batchId: string,
    status?: ImportAssetStatus,
  ): Promise<ImportAssetResult[]> {
    const rows = await this.prisma.db.importAssetResult.findMany({
      where: { batchId, ...(status ? { status } : {}) },
      orderBy: [{ propertyId: 'asc' }, { position: 'asc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      batchId: row.batchId,
      propertyId: row.propertyId,
      sourceUrl: row.sourceUrl,
      position: row.position,
      status: row.status as ImportAssetStatus,
      error: row.error,
      storageKey: row.storageKey,
    }))
  }

  async update(
    id: string,
    changes: {
      status: ImportAssetStatus
      error?: string | null
      storageKey?: string | null
    },
  ): Promise<void> {
    await this.prisma.db.importAssetResult.update({
      where: { id },
      data: {
        status: changes.status,
        error: changes.error?.slice(0, 300) ?? null,
        storageKey: changes.storageKey ?? null,
      },
    })
  }

  async resetFailed(batchId: string): Promise<number> {
    const { count } = await this.prisma.db.importAssetResult.updateMany({
      where: { batchId, status: ImportAssetStatus.FAILED },
      data: { status: ImportAssetStatus.PENDING, error: null },
    })
    return count
  }

  async countByStatus(
    batchId: string,
  ): Promise<Record<ImportAssetStatus, number>> {
    const groups = await this.prisma.db.importAssetResult.groupBy({
      by: ['status'],
      where: { batchId },
      _count: { _all: true },
    })
    const counts = {
      [ImportAssetStatus.PENDING]: 0,
      [ImportAssetStatus.MIGRATED]: 0,
      [ImportAssetStatus.FAILED]: 0,
    }
    for (const group of groups) {
      counts[group.status as ImportAssetStatus] = group._count._all
    }
    return counts
  }

  async countByProperty(
    batchId: string,
  ): Promise<Map<string, { migrated: number; failed: number }>> {
    const groups = await this.prisma.db.importAssetResult.groupBy({
      by: ['propertyId', 'status'],
      where: { batchId },
      _count: { _all: true },
    })
    const result = new Map<string, { migrated: number; failed: number }>()
    for (const group of groups) {
      const entry = result.get(group.propertyId) ?? { migrated: 0, failed: 0 }
      if (group.status === ImportAssetStatus.MIGRATED) {
        entry.migrated += group._count._all
      } else if (group.status === ImportAssetStatus.FAILED) {
        entry.failed += group._count._all
      }
      result.set(group.propertyId, entry)
    }
    return result
  }
}
