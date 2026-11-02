import { Injectable } from '@nestjs/common'

import { UserRef, UsersFacade } from '@/modules/auth/public'
import { IsoDate } from '@/shared/dates/calendar-date'
import {
  Inventory,
  InventoryStatus,
  InventoryType,
  ItemCondition,
} from '../domain/inventory'
import { InventoryPolicy } from '../domain/inventory.policy'

export interface InventoryPhotoView {
  id: string
  url: string
}

export interface InventoryItemView {
  id: string
  category: string
  description: string
  condition: ItemCondition
  notes: string | null
  photos: InventoryPhotoView[]
}

/** Calza con `InventorySummary` de shared-types. */
export interface InventorySummaryView {
  id: string
  contractId: string
  type: InventoryType
  date: IsoDate
  status: InventoryStatus
  tenantAcknowledged: boolean
  itemCount: number
  poorCount: number
  photoCount: number
  performedBy: UserRef | null
  confirmedAt: Date | null
  correctsInventoryId: string | null
}

/** Calza con `InventoryDetail` de shared-types. */
export interface InventoryDetailView extends InventorySummaryView {
  generalNotes: string | null
  correctionReason: string | null
  items: InventoryItemView[]
  warnings: string[]
}

export interface ContractInventoriesView {
  inventories: InventorySummaryView[]
  canCreateDelivery: boolean
  canCreateReturn: boolean
}

@Injectable()
export class InventoryViews {
  constructor(private readonly users: UsersFacade) {}

  async detail(inventory: Inventory): Promise<InventoryDetailView> {
    const [summary] = await this.summaries([inventory])
    return {
      ...summary,
      generalNotes: inventory.generalNotes,
      correctionReason: inventory.correctionReason,
      items: inventory.items.map((item) => ({
        id: item.id,
        category: item.category,
        description: item.description,
        condition: item.condition,
        notes: item.notes,
        photos: item.photos.map(({ id, url }) => ({ id, url })),
      })),
      warnings: InventoryPolicy.warnings(inventory.items),
    }
  }

  async summaries(inventories: Inventory[]): Promise<InventorySummaryView[]> {
    if (inventories.length === 0) return []
    const users = await this.users.describe(
      inventories.map((inventory) => inventory.performedById),
    )
    return inventories.map((inventory) => ({
      id: inventory.id,
      contractId: inventory.contractId,
      type: inventory.type,
      date: inventory.date,
      status: inventory.status,
      tenantAcknowledged: inventory.tenantAcknowledged,
      itemCount: inventory.items.length,
      poorCount: inventory.items.filter(
        (item) => item.condition === ItemCondition.POOR,
      ).length,
      photoCount: inventory.items.reduce(
        (total, item) => total + item.photos.length,
        0,
      ),
      performedBy: users.get(inventory.performedById) ?? null,
      confirmedAt: inventory.confirmedAt,
      correctsInventoryId: inventory.correctsInventoryId,
    }))
  }
}
