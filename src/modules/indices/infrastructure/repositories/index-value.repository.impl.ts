import { Injectable } from '@nestjs/common'
import { IndexValue as IndexValueRow } from '@prisma/client'

import { IndexType, IndexValue } from '@/modules/indices/domain/index-value'
import {
  IndexValueData,
  IndexValueRepository,
} from '@/modules/indices/domain/index-value.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'

/**
 * `prisma.db` también acá, por uniformidad: el modelo está declarado sin
 * tenant en `auditable-models.ts`, así que el filtro no se aplica.
 */
@Injectable()
export class IndexValueRepositoryImpl extends IndexValueRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: IndexValueData): Promise<IndexValue> {
    const row = await this.prisma.db.indexValue.create({ data })
    return toDomain(row)
  }

  async find(indexType: IndexType, period: string): Promise<IndexValue | null> {
    const row = await this.prisma.db.indexValue.findUnique({
      where: { indexType_period: { indexType, period } },
    })
    return row ? toDomain(row) : null
  }

  async listByType(indexType: IndexType): Promise<IndexValue[]> {
    const rows = await this.prisma.db.indexValue.findMany({
      where: { indexType },
      orderBy: { period: 'desc' },
    })
    return rows.map(toDomain)
  }
}

function toDomain(row: IndexValueRow): IndexValue {
  return {
    id: row.id,
    // Mismos valores en el enum de Prisma y en el del dominio.
    indexType: IndexType[row.indexType],
    period: row.period,
    value: row.value.toFixed(6),
    source: row.source,
    createdAt: row.createdAt,
  }
}
