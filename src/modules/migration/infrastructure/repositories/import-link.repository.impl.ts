import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { PrismaService } from '@/shared/prisma/prisma.service'
import { ImportLinkRepository } from '../../domain/migration.ports'
import { ImportEntity, ImportSource } from '../../domain/migration.types'

@Injectable()
export class ImportLinkRepositoryImpl extends ImportLinkRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async findTargets(
    source: ImportSource,
    entity: ImportEntity,
    externalKeys: string[],
  ): Promise<Map<string, string>> {
    if (externalKeys.length === 0) return new Map()
    const rows = await this.prisma.db.importLink.findMany({
      where: {
        source,
        entity,
        externalKey: { in: [...new Set(externalKeys)] },
      },
    })
    return new Map(rows.map((row) => [row.externalKey, row.targetId]))
  }

  async link(data: {
    source: ImportSource
    entity: ImportEntity
    externalKey: string
    targetId: string
    batchId: string
  }): Promise<void> {
    // Sin tenantId: lo completa la extensión (de ahí el cast).
    await this.prisma.db.importLink.createMany({
      data: [data as Prisma.ImportLinkCreateManyInput],
      skipDuplicates: true,
    })
  }
}
