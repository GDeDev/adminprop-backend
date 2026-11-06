import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { randomUUID } from 'node:crypto'

import { AuditFacade } from '@/modules/audit/public'
import { ContractsFacade } from '@/modules/contracts/public'
import { StoragePort, StoredFile } from '@/platform/storage/storage.port'
import { RequestContext } from '@/shared/context/request-context'
import { todayIso } from '@/shared/dates/calendar-date'
import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import { Inventory } from '../domain/inventory'
import {
  InvalidInventoryPhotoException,
  InventoryAlreadyExistsException,
  InventoryConfirmedException,
  InventoryContractNotFoundException,
  InventoryCorrectionPendingException,
  InventoryItemNotFoundException,
  InventoryNotFoundException,
  InventoryPhotoNotFoundException,
} from '../domain/inventory.exceptions'
import { InventoryPolicy } from '../domain/inventory.policy'
import {
  InventoryChanges,
  InventoryRepository,
} from '../domain/inventory.ports'
import {
  AddInventoryPhotosCommand,
  ConfirmInventoryCommand,
  CorrectInventoryCommand,
  CreateInventoryCommand,
  DeleteInventoryPhotoCommand,
  UpdateInventoryCommand,
} from './inventory.commands'
import { InventoryDetailView, InventoryViews } from './inventory.views'

export async function requireInventory(
  inventories: InventoryRepository,
  id: string,
): Promise<Inventory> {
  const inventory = await inventories.findById(id)
  if (!inventory) throw new InventoryNotFoundException(id)
  return inventory
}

function requireUser(): string {
  const userId = RequestContext.userId
  if (!userId)
    throw new Error('Operación de inventario sin usuario en el contexto')
  return userId
}

const logger = createLogger('InventoryHandlers')

/** Borra del storage los archivos que ya no usa ninguna foto. */
async function discardUnused(
  inventories: InventoryRepository,
  storage: StoragePort,
  keys: string[],
): Promise<void> {
  for (const key of new Set(keys)) {
    try {
      if ((await inventories.countPhotosByKey(key)) === 0) {
        await storage.delete(key)
      }
    } catch (error) {
      // La foto ya no se muestra; un archivo huérfano no justifica un error.
      logger.warn(
        { key, error: errorMessage(error) },
        'No se pudo borrar el archivo de una foto de inventario',
      )
    }
  }
}

/**
 * Alta (rediseño 2): un solo inventario vigente por contrato y tipo (A-42).
 * Sin ítems se precarga la plantilla estándar (A-43). La devolución sólo se
 * habilita al final del contrato (A-44).
 */
@CommandHandler(CreateInventoryCommand)
export class CreateInventoryHandler implements ICommandHandler<
  CreateInventoryCommand,
  InventoryDetailView
> {
  constructor(
    private readonly inventories: InventoryRepository,
    private readonly contracts: ContractsFacade,
    private readonly views: InventoryViews,
  ) {}

  async execute(command: CreateInventoryCommand): Promise<InventoryDetailView> {
    const { data } = command
    const contract = await this.contracts.find(command.contractId)
    if (!contract)
      throw new InventoryContractNotFoundException(command.contractId)

    const current = await this.inventories.listCurrentByContract(contract.id)
    if (current.some((inventory) => inventory.type === data.type)) {
      throw new InventoryAlreadyExistsException(data.type)
    }
    const today = todayIso()
    InventoryPolicy.assertCanCreate(data.type, contract, today)

    const items = data.items?.length
      ? InventoryPolicy.normalizeItems(data.items)
      : InventoryPolicy.standardItems()
    const created = await this.inventories.create({
      contractId: contract.id,
      type: data.type,
      date: data.date ? InventoryPolicy.normalizeDate(data.date) : today,
      generalNotes: InventoryPolicy.normalizeNotes(data.generalNotes),
      performedById: requireUser(),
      items,
    })
    return this.views.detail(created)
  }
}

/**
 * Edición del borrador (rediseño 2): reemplaza la lista de ítems. Los que
 * traen `id` se actualizan, los nuevos se crean y los que faltan se borran
 * con sus fotos.
 */
@CommandHandler(UpdateInventoryCommand)
export class UpdateInventoryHandler implements ICommandHandler<
  UpdateInventoryCommand,
  InventoryDetailView
> {
  constructor(
    private readonly inventories: InventoryRepository,
    private readonly storage: StoragePort,
    private readonly views: InventoryViews,
  ) {}

  async execute(command: UpdateInventoryCommand): Promise<InventoryDetailView> {
    const inventory = await requireInventory(this.inventories, command.id)
    InventoryPolicy.assertDraft(inventory)

    const { changes } = command
    const next: InventoryChanges = {}
    if (changes.date !== undefined) {
      next.date = InventoryPolicy.normalizeDate(changes.date)
    }
    if (changes.generalNotes !== undefined) {
      next.generalNotes = InventoryPolicy.normalizeNotes(changes.generalNotes)
    }
    if (changes.tenantAcknowledged !== undefined) {
      next.tenantAcknowledged = changes.tenantAcknowledged
    }
    if (changes.items !== undefined) {
      const known = new Set(inventory.items.map((item) => item.id))
      const normalized = InventoryPolicy.normalizeItems(changes.items)
      next.items = normalized.map((item, index) => {
        const id = changes.items?.[index].id
        if (id !== undefined && !known.has(id)) {
          throw new InventoryItemNotFoundException(id)
        }
        return { ...item, id }
      })
    }

    const { inventory: updated, removedKeys } = await this.inventories.update(
      inventory.id,
      next,
    )
    await discardUnused(this.inventories, this.storage, removedKeys)
    return this.views.detail(updated)
  }
}

/**
 * Fotos de un ítem (rediseño 2). Se validan todas por contenido antes de subir
 * ninguna y, si algo falla a mitad de camino, se borran del storage las que ya
 * habían subido: nunca quedan archivos huérfanos ni fotos a medias.
 */
@CommandHandler(AddInventoryPhotosCommand)
export class AddInventoryPhotosHandler implements ICommandHandler<
  AddInventoryPhotosCommand,
  InventoryDetailView
> {
  constructor(
    private readonly inventories: InventoryRepository,
    private readonly storage: StoragePort,
    private readonly audit: AuditFacade,
    private readonly views: InventoryViews,
  ) {}

  async execute(
    command: AddInventoryPhotosCommand,
  ): Promise<InventoryDetailView> {
    const inventory = await requireInventory(
      this.inventories,
      command.inventoryId,
    )
    InventoryPolicy.assertDraft(inventory)
    const item = inventory.items.find((i) => i.id === command.itemId)
    if (!item) throw new InventoryItemNotFoundException(command.itemId)

    if (command.files.length === 0) {
      throw new InvalidInventoryPhotoException('no se envió ningún archivo')
    }
    const kinds = command.files.map((file) => InventoryPolicy.photoKind(file))
    InventoryPolicy.assertCanAddPhotos(item.photos.length, command.files.length)

    const prefix = `inventories/${RequestContext.tenantId}/${inventory.id}`
    const uploaded: StoredFile[] = []
    try {
      for (const [index, file] of command.files.entries()) {
        uploaded.push(
          await this.storage.upload(
            file,
            `${prefix}/${randomUUID()}.${kinds[index].extension}`,
            // Privadas (D-248): muestran el interior de la vivienda del
            // inquilino; salen con URL firmada por `SignedUrlsInterceptor`.
            { contentType: kinds[index].contentType, access: 'private' },
          ),
        )
      }
      await this.inventories.addPhotos(
        item.id,
        uploaded.map((file) => ({ storageKey: file.key, url: file.url })),
      )
    } catch (error) {
      for (const file of uploaded) {
        await this.storage
          .delete(file.key)
          .catch((cause: unknown) =>
            logger.warn(
              { key: file.key, error: errorMessage(cause) },
              'No se pudo borrar una foto subida tras un fallo',
            ),
          )
      }
      throw error
    }

    await this.audit.record({
      action: 'UPDATE',
      entity: 'PropertyInventory',
      entityId: inventory.id,
      summary: `Se agregaron ${uploaded.length} foto(s) al ítem "${item.description}"`,
      changes: { photosAdded: { after: uploaded.length } },
    })
    return this.views.detail(
      await requireInventory(this.inventories, inventory.id),
    )
  }
}

@CommandHandler(DeleteInventoryPhotoCommand)
export class DeleteInventoryPhotoHandler implements ICommandHandler<
  DeleteInventoryPhotoCommand,
  InventoryDetailView
> {
  constructor(
    private readonly inventories: InventoryRepository,
    private readonly storage: StoragePort,
    private readonly audit: AuditFacade,
    private readonly views: InventoryViews,
  ) {}

  async execute(
    command: DeleteInventoryPhotoCommand,
  ): Promise<InventoryDetailView> {
    const inventory = await requireInventory(
      this.inventories,
      command.inventoryId,
    )
    InventoryPolicy.assertDraft(inventory)
    const photo = inventory.items
      .flatMap((item) => item.photos)
      .find((p) => p.id === command.photoId)
    if (!photo) throw new InventoryPhotoNotFoundException(command.photoId)

    await this.inventories.deletePhoto(photo.id)
    await discardUnused(this.inventories, this.storage, [photo.storageKey])
    await this.audit.record({
      action: 'UPDATE',
      entity: 'PropertyInventory',
      entityId: inventory.id,
      summary: 'Se borró una foto de un ítem',
      changes: { photosDeleted: { after: 1 } },
    })
    return this.views.detail(
      await requireInventory(this.inventories, inventory.id),
    )
  }
}

/**
 * Confirmación (rediseño 2): el borrador pasa a acta cerrada. Exige al menos
 * un ítem evaluado. Si es una corrección, el original queda reemplazado en la
 * misma transacción. Los ítems en mal estado sin foto vuelven como avisos.
 */
@CommandHandler(ConfirmInventoryCommand)
export class ConfirmInventoryHandler implements ICommandHandler<
  ConfirmInventoryCommand,
  InventoryDetailView
> {
  constructor(
    private readonly inventories: InventoryRepository,
    private readonly views: InventoryViews,
  ) {}

  async execute(
    command: ConfirmInventoryCommand,
  ): Promise<InventoryDetailView> {
    const inventory = await requireInventory(this.inventories, command.id)
    InventoryPolicy.assertDraft(inventory)
    InventoryPolicy.assertCanConfirm(inventory)

    const confirmed = await this.inventories.confirm(
      inventory.id,
      new Date(),
      requireUser(),
    )
    // Otro pedido lo confirmó en el medio.
    if (!confirmed) throw new InventoryConfirmedException()
    return this.views.detail(
      await requireInventory(this.inventories, inventory.id),
    )
  }
}

/**
 * Corrección (A-42): copia el inventario confirmado en un borrador nuevo, con
 * el motivo. Las fotos se copian apuntando al mismo archivo. Recién al
 * confirmarla reemplaza al original.
 */
@CommandHandler(CorrectInventoryCommand)
export class CorrectInventoryHandler implements ICommandHandler<
  CorrectInventoryCommand,
  InventoryDetailView
> {
  constructor(
    private readonly inventories: InventoryRepository,
    private readonly views: InventoryViews,
  ) {}

  async execute(
    command: CorrectInventoryCommand,
  ): Promise<InventoryDetailView> {
    const original = await requireInventory(this.inventories, command.id)
    InventoryPolicy.assertCanCorrect(original)
    const pending = await this.inventories.findCorrectionOf(original.id)
    if (pending) throw new InventoryCorrectionPendingException(pending.id)

    const created = await this.inventories.create({
      contractId: original.contractId,
      type: original.type,
      date: todayIso(),
      generalNotes: original.generalNotes,
      performedById: requireUser(),
      correctsInventoryId: original.id,
      correctionReason: command.reason.trim(),
      items: original.items.map((item) => ({
        category: item.category,
        description: item.description,
        condition: item.condition,
        notes: item.notes,
        photos: item.photos.map(({ storageKey, url }) => ({ storageKey, url })),
      })),
    })
    return this.views.detail(created)
  }
}
