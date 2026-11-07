import { InventoryType, ItemCondition } from '../domain/inventory'

export interface ItemInput {
  id?: string
  category: string
  description: string
  condition: ItemCondition
  notes: string | null
}

export class CreateInventoryCommand {
  constructor(
    public readonly contractId: string,
    public readonly data: {
      type: InventoryType
      date?: string
      generalNotes?: string | null
      /** Sin ítems se precarga la plantilla estándar. */
      items?: ItemInput[]
    },
  ) {}
}

export class UpdateInventoryCommand {
  constructor(
    public readonly id: string,
    public readonly changes: {
      date?: string
      generalNotes?: string | null
      tenantAcknowledged?: boolean
      items?: ItemInput[]
    },
  ) {}
}

export class AddInventoryPhotosCommand {
  constructor(
    public readonly inventoryId: string,
    public readonly itemId: string,
    public readonly files: Buffer[],
  ) {}
}

export class DeleteInventoryPhotoCommand {
  constructor(
    public readonly inventoryId: string,
    public readonly photoId: string,
  ) {}
}

export class ConfirmInventoryCommand {
  constructor(public readonly id: string) {}
}

export class CorrectInventoryCommand {
  constructor(
    public readonly id: string,
    public readonly reason: string,
  ) {}
}
