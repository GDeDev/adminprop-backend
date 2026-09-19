import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { randomUUID } from 'node:crypto'

import { Property } from '@/modules/properties/domain/property'
import {
  PropertyNotFoundException,
  PropertyPhotoNotFoundException,
} from '@/modules/properties/domain/property.exceptions'
import { PropertyPolicy } from '@/modules/properties/domain/property.policy'
import {
  PropertyContracts,
  PropertyRepository,
} from '@/modules/properties/domain/property.ports'
import { StoragePort, StoredFile } from '@/platform/storage/storage.port'
import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import { MasterDataReferences } from '../master-data-references'
import { PropertyDetailView, PropertyViews } from '../property.views'
import {
  AddPropertyPhotosCommand,
  ChangePropertyStatusCommand,
  CreatePropertyCommand,
  DeletePropertyCommand,
  DeletePropertyPhotoCommand,
  UpdatePropertyCommand,
} from './property.commands'

async function requireProperty(
  properties: PropertyRepository,
  id: string,
): Promise<Property> {
  const property = await properties.findById(id)
  if (!property) throw new PropertyNotFoundException(id)
  return property
}

/** Alta (spec 3.1): nace `AVAILABLE`, sin fotos (tienen su endpoint). */
@CommandHandler(CreatePropertyCommand)
export class CreatePropertyHandler implements ICommandHandler<
  CreatePropertyCommand,
  PropertyDetailView
> {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly references: MasterDataReferences,
    private readonly views: PropertyViews,
  ) {}

  async execute({ data }: CreatePropertyCommand): Promise<PropertyDetailView> {
    const amenityIds = [...new Set(data.amenityIds)]
    await this.references.assertSelectable({
      locationId: data.locationId,
      propertyTypeId: data.propertyTypeId,
      amenityIds,
    })

    const property = await this.properties.create({
      ...data,
      address: PropertyPolicy.normalizeAddress(data.address),
      notes: PropertyPolicy.normalizeNotes(data.notes),
      amenityIds,
    })
    return this.views.detail(property)
  }
}

/** Edición (spec 3.4): todo menos estado y fotos, que tienen endpoint propio. */
@CommandHandler(UpdatePropertyCommand)
export class UpdatePropertyHandler implements ICommandHandler<
  UpdatePropertyCommand,
  PropertyDetailView
> {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly references: MasterDataReferences,
    private readonly views: PropertyViews,
  ) {}

  async execute(command: UpdatePropertyCommand): Promise<PropertyDetailView> {
    const current = await requireProperty(this.properties, command.id)
    const changes = { ...command.changes }

    if (changes.amenityIds)
      changes.amenityIds = [...new Set(changes.amenityIds)]

    // Sólo se valida lo que cambia: una propiedad vieja puede conservar un
    // tipo o una ubicación que después se desactivó (Fase 5, 4).
    const newAmenities = changes.amenityIds?.filter(
      (id) => !current.amenityIds.includes(id),
    )
    await this.references.assertSelectable({
      locationId:
        changes.locationId !== current.locationId
          ? changes.locationId
          : undefined,
      propertyTypeId:
        changes.propertyTypeId !== current.propertyTypeId
          ? changes.propertyTypeId
          : undefined,
      amenityIds: newAmenities?.length ? newAmenities : undefined,
    })

    if (changes.address !== undefined) {
      changes.address = PropertyPolicy.normalizeAddress(changes.address)
    }
    if (changes.notes !== undefined) {
      changes.notes = PropertyPolicy.normalizeNotes(changes.notes)
    }

    const updated = await this.properties.update(current.id, changes)
    return this.views.detail(updated)
  }
}

/** Cambio manual de estado (spec 3.5 y 4). */
@CommandHandler(ChangePropertyStatusCommand)
export class ChangePropertyStatusHandler implements ICommandHandler<
  ChangePropertyStatusCommand,
  PropertyDetailView
> {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly contracts: PropertyContracts,
    private readonly views: PropertyViews,
  ) {}

  async execute(
    command: ChangePropertyStatusCommand,
  ): Promise<PropertyDetailView> {
    const property = await requireProperty(this.properties, command.id)
    if (property.status === command.status) return this.views.detail(property)

    PropertyPolicy.assertCanChangeStatus(
      property.status,
      command.status,
      await this.contracts.hasActiveContract(property.id),
    )
    const updated = await this.properties.setStatus(property.id, command.status)
    return this.views.detail(updated)
  }
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Fotos (spec 3.6). Primero se suben todas al storage y recién después se
 * guardan juntas en una transacción. Si algo falla a mitad de camino, se
 * borran del storage las que ya habían subido: nunca queda la lista de fotos
 * a medias (spec, casos borde) ni archivos huérfanos.
 */
@CommandHandler(AddPropertyPhotosCommand)
export class AddPropertyPhotosHandler implements ICommandHandler<
  AddPropertyPhotosCommand,
  PropertyDetailView
> {
  private readonly logger = createLogger('AddPropertyPhotosHandler')

  constructor(
    private readonly properties: PropertyRepository,
    private readonly storage: StoragePort,
    private readonly views: PropertyViews,
  ) {}

  async execute(
    command: AddPropertyPhotosCommand,
  ): Promise<PropertyDetailView> {
    const property = await requireProperty(this.properties, command.propertyId)
    PropertyPolicy.assertCanAddPhotos(
      property.photos.length,
      command.files.length,
    )

    const uploaded: StoredFile[] = []
    try {
      for (const file of command.files) {
        const extension = EXTENSION_BY_MIME[file.mimeType] ?? 'bin'
        uploaded.push(
          await this.storage.upload(
            file.buffer,
            `properties/${property.id}/${randomUUID()}.${extension}`,
            { contentType: file.mimeType },
          ),
        )
      }
      await this.properties.addPhotos(
        property.id,
        uploaded.map((file) => ({ storageKey: file.key, url: file.url })),
      )
    } catch (error) {
      await this.discard(uploaded)
      throw error
    }

    return this.views.detail(
      await requireProperty(this.properties, property.id),
    )
  }

  private async discard(files: StoredFile[]): Promise<void> {
    for (const file of files) {
      try {
        await this.storage.delete(file.key)
      } catch (error) {
        // No tapa el error original: queda un archivo huérfano, y se avisa.
        this.logger.warn(
          { key: file.key, error: errorMessage(error) },
          'No se pudo borrar una foto subida tras un fallo',
        )
      }
    }
  }
}

/** Spec 3.7: saca la foto de la propiedad y borra el archivo. */
@CommandHandler(DeletePropertyPhotoCommand)
export class DeletePropertyPhotoHandler implements ICommandHandler<
  DeletePropertyPhotoCommand,
  PropertyDetailView
> {
  private readonly logger = createLogger('DeletePropertyPhotoHandler')

  constructor(
    private readonly properties: PropertyRepository,
    private readonly storage: StoragePort,
    private readonly views: PropertyViews,
  ) {}

  async execute(
    command: DeletePropertyPhotoCommand,
  ): Promise<PropertyDetailView> {
    const property = await requireProperty(this.properties, command.propertyId)
    const photo = property.photos.find((p) => p.id === command.photoId)
    if (!photo) throw new PropertyPhotoNotFoundException(command.photoId)

    await this.properties.deletePhoto(property.id, photo.id)
    try {
      await this.storage.delete(photo.storageKey)
    } catch (error) {
      // La foto ya no se muestra; un archivo huérfano no justifica un error.
      this.logger.warn(
        { key: photo.storageKey, error: errorMessage(error) },
        'No se pudo borrar el archivo de una foto',
      )
    }

    return this.views.detail(
      await requireProperty(this.properties, property.id),
    )
  }
}

/** Spec 3.8: borrado lógico, sólo sin historial de contratos. */
@CommandHandler(DeletePropertyCommand)
export class DeletePropertyHandler implements ICommandHandler<
  DeletePropertyCommand,
  void
> {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly contracts: PropertyContracts,
  ) {}

  async execute(command: DeletePropertyCommand): Promise<void> {
    const property = await requireProperty(this.properties, command.id)
    PropertyPolicy.assertCanDelete(
      await this.contracts.hasContractHistory(property.id),
    )
    await this.properties.softDelete(property.id)
  }
}
