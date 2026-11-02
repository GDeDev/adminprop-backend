import { Injectable } from '@nestjs/common'
import {
  InventoryItem as ItemRow,
  InventoryPhoto as PhotoRow,
  Prisma,
  PropertyInventory as InventoryRow,
} from '@prisma/client'

import {
  Inventory,
  InventoryStatus,
  InventoryType,
  ItemCondition,
} from '@/modules/inventory/domain/inventory'
import {
  InventoryChanges,
  InventoryRepository,
  NewInventory,
  NewInventoryItem,
} from '@/modules/inventory/domain/inventory.ports'
import { IsoDate } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'

type FullRow = InventoryRow & {
  items: (ItemRow & { photos: PhotoRow[] })[]
}

const INCLUDE = {
  items: {
    orderBy: { position: 'asc' },
    include: { photos: { orderBy: { position: 'asc' } } },
  },
} satisfies Prisma.PropertyInventoryInclude

const toDateColumn = (value: IsoDate) => new Date(`${value}T00:00:00.000Z`)

/** Siempre `prisma.db`: el tenant y la auditoría se aplican solos. */
@Injectable()
export class InventoryRepositoryImpl extends InventoryRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  create(data: NewInventory): Promise<Inventory> {
    return this.prisma.db.$transaction(async (tx) => {
      const row = await tx.propertyInventory.create({
        data: {
          contractId: data.contractId,
          type: data.type,
          date: toDateColumn(data.date),
          generalNotes: data.generalNotes,
          performedById: data.performedById,
          correctsInventoryId: data.correctsInventoryId ?? null,
          correctionReason: data.correctionReason ?? null,
        } as Prisma.PropertyInventoryUncheckedCreateInput,
      })
      for (const [index, item] of data.items.entries()) {
        await createItem(tx, row.id, item, index)
      }
      return toDomain(
        await tx.propertyInventory.findFirstOrThrow({
          where: { id: row.id },
          include: INCLUDE,
        }),
      )
    })
  }

  async findById(id: string): Promise<Inventory | null> {
    const row = await this.prisma.db.propertyInventory.findFirst({
      where: { id },
      include: INCLUDE,
    })
    return row ? toDomain(row) : null
  }

  async listCurrentByContract(contractId: string): Promise<Inventory[]> {
    const rows = await this.prisma.db.propertyInventory.findMany({
      where: { contractId, supersededById: null },
      include: INCLUDE,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toDomain)
  }

  async findCorrectionOf(inventoryId: string): Promise<Inventory | null> {
    const row = await this.prisma.db.propertyInventory.findFirst({
      where: { correctsInventoryId: inventoryId },
      include: INCLUDE,
    })
    return row ? toDomain(row) : null
  }

  update(
    id: string,
    changes: InventoryChanges,
  ): Promise<{ inventory: Inventory; removedKeys: string[] }> {
    return this.prisma.db.$transaction(async (tx) => {
      const { date, items, ...rest } = changes
      await tx.propertyInventory.update({
        where: { id },
        data: {
          ...rest,
          ...(date !== undefined ? { date: toDateColumn(date) } : {}),
        },
      })

      const removedKeys: string[] = []
      if (items) {
        const current = await tx.inventoryItem.findMany({
          where: { inventoryId: id },
          include: { photos: true },
        })
        const kept = new Set(
          items.flatMap((item) => (item.id ? [item.id] : [])),
        )
        const dropped = current.filter((item) => !kept.has(item.id))
        removedKeys.push(
          ...dropped.flatMap((item) => item.photos.map((p) => p.storageKey)),
        )
        if (dropped.length) {
          await tx.inventoryItem.deleteMany({
            where: { id: { in: dropped.map((item) => item.id) } },
          })
        }
        for (const [index, item] of items.entries()) {
          if (item.id) {
            await tx.inventoryItem.update({
              where: { id: item.id },
              data: {
                category: item.category,
                description: item.description,
                condition: item.condition,
                notes: item.notes,
                position: index,
              },
            })
          } else {
            await createItem(tx, id, item, index)
          }
        }
      }

      const row = await tx.propertyInventory.findFirstOrThrow({
        where: { id },
        include: INCLUDE,
      })
      return { inventory: toDomain(row), removedKeys }
    })
  }

  async addPhotos(
    itemId: string,
    photos: { storageKey: string; url: string }[],
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const last = await tx.inventoryPhoto.findFirst({
        where: { itemId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const start = (last?.position ?? -1) + 1
      for (const [index, photo] of photos.entries()) {
        await tx.inventoryPhoto.create({
          data: {
            itemId,
            storageKey: photo.storageKey,
            url: photo.url,
            position: start + index,
          } as Prisma.InventoryPhotoUncheckedCreateInput,
        })
      }
    })
  }

  async deletePhoto(photoId: string): Promise<void> {
    await this.prisma.db.inventoryPhoto.deleteMany({ where: { id: photoId } })
  }

  countPhotosByKey(storageKey: string): Promise<number> {
    return this.prisma.db.inventoryPhoto.count({ where: { storageKey } })
  }

  confirm(
    id: string,
    confirmedAt: Date,
    confirmedById: string,
  ): Promise<boolean> {
    return this.prisma.db.$transaction(async (tx) => {
      const result = await tx.propertyInventory.updateMany({
        where: { id, status: InventoryStatus.DRAFT },
        data: { status: InventoryStatus.CONFIRMED, confirmedAt, confirmedById },
      })
      if (result.count === 0) return false
      const confirmed = await tx.propertyInventory.findFirstOrThrow({
        where: { id },
        select: { correctsInventoryId: true },
      })
      if (confirmed.correctsInventoryId) {
        await tx.propertyInventory.update({
          where: { id: confirmed.correctsInventoryId },
          data: { supersededById: id },
        })
      }
      return true
    })
  }
}

async function createItem(
  tx: Pick<PrismaService['db'], 'inventoryItem' | 'inventoryPhoto'>,
  inventoryId: string,
  item: Omit<NewInventoryItem, 'photos'> & Pick<NewInventoryItem, 'photos'>,
  position: number,
): Promise<void> {
  const created = await tx.inventoryItem.create({
    data: {
      inventoryId,
      category: item.category,
      description: item.description,
      condition: item.condition,
      notes: item.notes,
      position,
    } as Prisma.InventoryItemUncheckedCreateInput,
  })
  for (const [index, photo] of (item.photos ?? []).entries()) {
    await tx.inventoryPhoto.create({
      data: {
        itemId: created.id,
        storageKey: photo.storageKey,
        url: photo.url,
        position: index,
      } as Prisma.InventoryPhotoUncheckedCreateInput,
    })
  }
}

function toDomain(row: FullRow): Inventory {
  return {
    id: row.id,
    contractId: row.contractId,
    type: row.type as InventoryType,
    date: row.date.toISOString().slice(0, 10),
    status: row.status as InventoryStatus,
    performedById: row.performedById,
    tenantAcknowledged: row.tenantAcknowledged,
    generalNotes: row.generalNotes,
    confirmedAt: row.confirmedAt,
    confirmedById: row.confirmedById,
    correctsInventoryId: row.correctsInventoryId,
    correctionReason: row.correctionReason,
    supersededById: row.supersededById,
    items: row.items.map((item) => ({
      id: item.id,
      category: item.category,
      description: item.description,
      condition: item.condition as ItemCondition,
      notes: item.notes,
      position: item.position,
      photos: item.photos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        storageKey: photo.storageKey,
        position: photo.position,
      })),
    })),
  }
}
