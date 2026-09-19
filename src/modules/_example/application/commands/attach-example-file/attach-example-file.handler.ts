import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { extname } from 'node:path'

import { ExampleItemNotFoundException } from '@/modules/_example/domain/example-item.exceptions'
import { ExampleItemRepository } from '@/modules/_example/domain/example-item.repository'
import { StoragePort } from '@/platform/storage/storage.port'
import { ExampleItemView, toExampleItemView } from '../../example-item.view'
import { AttachExampleFileCommand } from './attach-example-file.command'

/**
 * Sube un adjunto por `StoragePort`: el handler no sabe si termina en disco,
 * en Cloudinary o, mañana, en S3. Guarda la `key` (para poder borrarlo) y la
 * URL (para mostrarlo).
 */
@CommandHandler(AttachExampleFileCommand)
export class AttachExampleFileHandler implements ICommandHandler<
  AttachExampleFileCommand,
  ExampleItemView
> {
  constructor(
    private readonly items: ExampleItemRepository,
    private readonly storage: StoragePort,
  ) {}

  async execute(command: AttachExampleFileCommand): Promise<ExampleItemView> {
    const item = await this.items.findById(command.id)
    if (!item) throw new ExampleItemNotFoundException(command.id)

    // Nombre propio y no el que mandó el cliente: evita paths raros y pisar
    // otro archivo por accidente.
    const extension = extname(command.originalName).toLowerCase()
    const stored = await this.storage.upload(
      command.file,
      `examples/${item.id}/attachment-${Date.now()}${extension}`,
      { contentType: command.contentType },
    )

    const previousKey = item.attachmentKey
    const updated = await this.items.setAttachment(item.id, stored)

    // El anterior se borra recién después de guardar el nuevo: si algo falla
    // en el medio, queda un archivo huérfano, nunca un ítem sin adjunto.
    if (previousKey) await this.storage.delete(previousKey)

    return toExampleItemView(updated)
  }
}
