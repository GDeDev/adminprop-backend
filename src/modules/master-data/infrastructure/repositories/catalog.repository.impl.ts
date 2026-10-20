import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  ActiveFilter,
  Catalog,
  CatalogItem,
} from '@/modules/master-data/domain/catalog'
import {
  CatalogItemData,
  CatalogRepository,
} from '@/modules/master-data/domain/master-data.repositories'
import { PrismaService } from '@/shared/prisma/prisma.service'

interface CatalogRow {
  id: string
  name: string
  icon?: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

interface CatalogWhere {
  id?: string | { in: string[] } | { not: string }
  isActive?: boolean
  name?: { equals: string; mode: 'insensitive' }
}

/**
 * Lo que este repositorio usa de cada delegate de Prisma. Los cuatro modelos
 * tienen las mismas columnas (amenities, además, `icon`), así que los cuatro
 * delegates encajan en esta forma sin casts.
 */
interface CatalogDelegate {
  findMany(args: {
    where: CatalogWhere
    orderBy: { name: 'asc' }
  }): PromiseLike<CatalogRow[]>
  findFirst(args: { where: CatalogWhere }): PromiseLike<CatalogRow | null>
  count(args: { where: CatalogWhere }): PromiseLike<number>
  create(args: { data: { name: string } }): PromiseLike<CatalogRow>
  update(args: {
    where: { id: string }
    data: { name?: string; isActive?: boolean }
  }): PromiseLike<CatalogRow>
}

const ACTIVE_WHERE: Record<ActiveFilter, CatalogWhere> = {
  active: { isActive: true },
  inactive: { isActive: false },
  all: {},
}

/**
 * Siempre `prisma.db`: el filtro de tenant y la auditoría se aplican solos.
 * Ningún `where` menciona el tenant.
 */
@Injectable()
export class CatalogRepositoryImpl extends CatalogRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async list(catalog: Catalog, filter: ActiveFilter): Promise<CatalogItem[]> {
    const rows = await this.delegate(catalog).findMany({
      where: ACTIVE_WHERE[filter],
      orderBy: { name: 'asc' },
    })
    return rows.map(toDomain)
  }

  async findById(catalog: Catalog, id: string): Promise<CatalogItem | null> {
    const row = await this.delegate(catalog).findFirst({ where: { id } })
    return row ? toDomain(row) : null
  }

  async existsByName(
    catalog: Catalog,
    name: string,
    exceptId?: string,
  ): Promise<boolean> {
    const count = await this.delegate(catalog).count({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    })
    return count > 0
  }

  async create(catalog: Catalog, data: CatalogItemData): Promise<CatalogItem> {
    // Amenities es el único con `icon`. El tenant lo completa la extensión:
    // el cast es porque el tipo de Prisma no sabe que lo agrega.
    if (catalog === Catalog.AMENITIES) {
      const row = await this.prisma.db.amenity.create({
        data: {
          name: data.name,
          icon: data.icon ?? null,
        } as Prisma.AmenityUncheckedCreateInput,
      })
      return toDomain(row)
    }
    const row = await this.delegate(catalog).create({
      data: { name: data.name },
    })
    return toDomain(row)
  }

  async update(
    catalog: Catalog,
    id: string,
    data: Partial<CatalogItemData>,
  ): Promise<CatalogItem> {
    if (catalog === Catalog.AMENITIES) {
      const row = await this.prisma.db.amenity.update({
        where: { id },
        data: { name: data.name, icon: data.icon },
      })
      return toDomain(row)
    }
    const row = await this.delegate(catalog).update({
      where: { id },
      data: { name: data.name },
    })
    return toDomain(row)
  }

  async setActive(
    catalog: Catalog,
    id: string,
    isActive: boolean,
  ): Promise<CatalogItem> {
    const row = await this.delegate(catalog).update({
      where: { id },
      data: { isActive },
    })
    return toDomain(row)
  }

  async countActive(catalog: Catalog, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    return this.delegate(catalog).count({
      where: { id: { in: ids }, isActive: true },
    })
  }

  private delegate(catalog: Catalog): CatalogDelegate {
    const db = this.prisma.db
    switch (catalog) {
      case Catalog.PROPERTY_TYPES:
        return db.propertyType
      case Catalog.AMENITIES:
        return db.amenity
      case Catalog.OPERATION_TYPES:
        return db.operationType
      case Catalog.SERVICE_TYPES:
        return db.serviceType
    }
  }
}

function toDomain(row: CatalogRow): CatalogItem {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
