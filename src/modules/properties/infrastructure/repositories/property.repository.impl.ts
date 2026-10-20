import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  Property,
  PropertyPhoto,
  PropertyStatus,
} from '@/modules/properties/domain/property'
import {
  PropertyData,
  PropertyFilter,
  PropertyRepository,
} from '@/modules/properties/domain/property.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'

const ALL_PHOTOS = { photos: { orderBy: { position: 'asc' } } } as const
/** En el listado alcanza con la principal. */
const MAIN_PHOTO = {
  photos: { orderBy: { position: 'asc' }, take: 1 },
} as const

type PropertyRow = Prisma.PropertyGetPayload<{ include: typeof ALL_PHOTOS }>
type PhotoRow = PropertyRow['photos'][number]

/**
 * Siempre `prisma.db`: tenant, soft delete y auditoría se aplican solos.
 */
@Injectable()
export class PropertyRepositoryImpl extends PropertyRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: PropertyData): Promise<Property> {
    // Sin tenantId: lo completa la extensión (de ahí el cast).
    const row = await this.prisma.db.property.create({
      data: data as Prisma.PropertyUncheckedCreateInput,
      include: ALL_PHOTOS,
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<Property | null> {
    const row = await this.prisma.db.property.findFirst({
      where: { id },
      include: ALL_PHOTOS,
    })
    return row ? toDomain(row) : null
  }

  async list(
    filter: PropertyFilter,
    page: { skip: number; take: number },
  ): Promise<[Property[], number]> {
    const where: Prisma.PropertyWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
      ...(filter.propertyTypeId
        ? { propertyTypeId: filter.propertyTypeId }
        : {}),
      // ILIKE '%...%': lo resuelve el índice trigram de la dirección.
      ...(filter.search
        ? { address: { contains: filter.search, mode: 'insensitive' } }
        : {}),
    }

    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.property.findMany({
        where,
        include: MAIN_PHOTO,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.property.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async update(id: string, data: Partial<PropertyData>): Promise<Property> {
    const row = await this.prisma.db.property.update({
      where: { id },
      data,
      include: ALL_PHOTOS,
    })
    return toDomain(row)
  }

  async setStatus(id: string, status: PropertyStatus): Promise<Property> {
    const row = await this.prisma.db.property.update({
      where: { id },
      data: { status },
      include: ALL_PHOTOS,
    })
    return toDomain(row)
  }

  async attachContract(id: string, contractId: string): Promise<Property> {
    const row = await this.prisma.db.property.update({
      where: { id },
      data: {
        activeContractId: contractId,
        lastContractId: contractId,
        status: PropertyStatus.RENTED,
      },
      include: ALL_PHOTOS,
    })
    return toDomain(row)
  }

  async detachContract(id: string): Promise<Property> {
    const row = await this.prisma.db.property.update({
      where: { id },
      data: { activeContractId: null, status: PropertyStatus.AVAILABLE },
      include: ALL_PHOTOS,
    })
    return toDomain(row)
  }

  async softDelete(id: string): Promise<void> {
    // La extensión de soft delete lo convierte en `deletedAt = now()`.
    await this.prisma.db.property.delete({ where: { id } })
  }

  async addPhotos(
    propertyId: string,
    photos: { storageKey: string; url: string }[],
  ): Promise<PropertyPhoto[]> {
    return this.prisma.db.$transaction(async (tx) => {
      const last = await tx.propertyPhoto.findFirst({
        where: { propertyId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const start = (last?.position ?? -1) + 1

      const created: PhotoRow[] = []
      for (const [index, photo] of photos.entries()) {
        created.push(
          await tx.propertyPhoto.create({
            data: {
              propertyId,
              storageKey: photo.storageKey,
              url: photo.url,
              position: start + index,
            } as Prisma.PropertyPhotoUncheckedCreateInput,
          }),
        )
      }
      return created.map(photoToDomain)
    })
  }

  async countByOwners(
    ownerIds: string[],
  ): Promise<{ ownerId: string; total: number; active: number }[]> {
    if (ownerIds.length === 0) return []
    // `groupBy` no agrupa por "tiene o no contrato": se cuenta dos veces.
    const [totals, actives] = await this.prisma.db.$transaction([
      this.prisma.db.property.groupBy({
        by: ['ownerId'],
        where: { ownerId: { in: ownerIds } },
        _count: { _all: true },
      }),
      this.prisma.db.property.groupBy({
        by: ['ownerId'],
        where: { ownerId: { in: ownerIds }, activeContractId: { not: null } },
        _count: { _all: true },
      }),
    ])
    const activeByOwner = new Map(
      actives.map((group) => [group.ownerId, group._count._all]),
    )
    return totals.flatMap((group) =>
      group.ownerId
        ? [
            {
              ownerId: group.ownerId,
              total: group._count._all,
              active: activeByOwner.get(group.ownerId) ?? 0,
            },
          ]
        : [],
    )
  }

  async findByIds(ids: string[]): Promise<Property[]> {
    if (ids.length === 0) return []
    const rows = await this.prisma.db.property.findMany({
      where: { id: { in: ids } },
      include: MAIN_PHOTO,
    })
    return rows.map(toDomain)
  }

  async listByOwner(ownerId: string): Promise<Property[]> {
    const rows = await this.prisma.db.property.findMany({
      where: { ownerId },
      include: MAIN_PHOTO,
      orderBy: { address: 'asc' },
    })
    return rows.map(toDomain)
  }

  async deletePhoto(propertyId: string, photoId: string): Promise<void> {
    await this.prisma.db.propertyPhoto.deleteMany({
      where: { id: photoId, propertyId },
    })
  }
}

function toDomain(row: PropertyRow): Property {
  return {
    id: row.id,
    address: row.address,
    locationId: row.locationId,
    propertyTypeId: row.propertyTypeId,
    status: row.status as PropertyStatus,
    ownerId: row.ownerId,
    amenityIds: row.amenityIds,
    notes: row.notes,
    activeContractId: row.activeContractId,
    lastContractId: row.lastContractId,
    photos: row.photos.map(photoToDomain),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function photoToDomain(row: PhotoRow): PropertyPhoto {
  return {
    id: row.id,
    url: row.url,
    storageKey: row.storageKey,
    position: row.position,
    createdAt: row.createdAt,
  }
}
