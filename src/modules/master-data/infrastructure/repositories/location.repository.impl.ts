import { Injectable } from '@nestjs/common'
import { Location as LocationRow, Prisma } from '@prisma/client'

import { Location, LocationLevel } from '@/modules/master-data/domain/location'
import {
  LocationFilter,
  LocationRepository,
} from '@/modules/master-data/domain/master-data.repositories'
import { PrismaService } from '@/shared/prisma/prisma.service'

const ACTIVE_WHERE = {
  active: { isActive: true },
  inactive: { isActive: false },
  all: {},
} as const

@Injectable()
export class LocationRepositoryImpl extends LocationRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async list(filter: LocationFilter): Promise<Location[]> {
    const rows = await this.prisma.db.location.findMany({
      where: {
        ...ACTIVE_WHERE[filter.active],
        ...(filter.level ? { level: filter.level } : {}),
        ...(filter.parentId !== undefined ? { parentId: filter.parentId } : {}),
      },
      orderBy: { name: 'asc' },
    })
    return rows.map(toDomain)
  }

  async findById(id: string): Promise<Location | null> {
    const row = await this.prisma.db.location.findFirst({ where: { id } })
    return row ? toDomain(row) : null
  }

  async existsByName(
    parentId: string | null,
    name: string,
    exceptId?: string,
  ): Promise<boolean> {
    const count = await this.prisma.db.location.count({
      where: {
        parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    })
    return count > 0
  }

  async create(data: {
    level: LocationLevel
    name: string
    parentId: string | null
  }): Promise<Location> {
    // Sin tenantId: lo completa la extensión (de ahí el cast).
    const row = await this.prisma.db.location.create({
      data: data as Prisma.LocationUncheckedCreateInput,
    })
    return toDomain(row)
  }

  async rename(id: string, name: string): Promise<Location> {
    const row = await this.prisma.db.location.update({
      where: { id },
      data: { name },
    })
    return toDomain(row)
  }

  async setActive(id: string, isActive: boolean): Promise<Location> {
    const row = await this.prisma.db.location.update({
      where: { id },
      data: { isActive },
    })
    return toDomain(row)
  }
}

function toDomain(row: LocationRow): Location {
  return {
    id: row.id,
    level: row.level as LocationLevel,
    name: row.name,
    parentId: row.parentId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
