import {
  CommandHandler,
  ICommandHandler,
  IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs'

import { UsersFacade } from '@/modules/auth/public'
import { QueuePort } from '@/platform/queue/queue.port'
import { PaginatedResult, paginateWith } from '@/shared/pagination'
import { DocumentKind, DocumentStatus } from '../domain/document'
import { DocumentNotFoundException } from '../domain/document.exceptions'
import { GeneratedDocumentRepository } from '../domain/document.ports'
import { DocumentAccess, DocumentViewer } from './document-access'
import { DocumentGenerator } from './document-generator'
import {
  DOCUMENT_REGENERATE_QUEUE,
  DocumentRegeneratePayload,
} from './document-queues'
import { GeneratedDocumentView, toDocumentView } from './document.views'

export class GetDocumentQuery {
  constructor(
    public readonly kind: DocumentKind,
    public readonly entityId: string,
    public readonly viewer: DocumentViewer,
  ) {}
}

export class ListDocumentsQuery {
  constructor(
    public readonly filter: {
      kind?: DocumentKind
      entityId?: string
      status?: DocumentStatus
    },
    public readonly page: { page?: number; limit?: number },
  ) {}
}

export class RegenerateDocumentCommand {
  constructor(
    public readonly kind: DocumentKind,
    public readonly entityId: string,
    public readonly requestedById: string,
  ) {}
}

/**
 * El vigente (`READY`); si todavía no hay, la versión más nueva (`PENDING` o
 * `FAILED`); si nunca se pidió, 404. Un usuario de portal ve un documento
 * ajeno exactamente como uno inexistente.
 */
@QueryHandler(GetDocumentQuery)
export class GetDocumentHandler implements IQueryHandler<
  GetDocumentQuery,
  GeneratedDocumentView
> {
  constructor(
    private readonly documents: GeneratedDocumentRepository,
    private readonly access: DocumentAccess,
    private readonly users: UsersFacade,
  ) {}

  async execute(query: GetDocumentQuery): Promise<GeneratedDocumentView> {
    if (
      !(await this.access.canRead(query.viewer, query.kind, query.entityId))
    ) {
      throw new DocumentNotFoundException()
    }
    const document =
      (await this.documents.findCurrent(query.kind, query.entityId)) ??
      (await this.documents.findLatest(query.kind, query.entityId))
    if (!document) throw new DocumentNotFoundException()
    const users = await this.users.describe(
      document.requestedById ? [document.requestedById] : [],
    )
    return toDocumentView(document, users, {
      hideError: !this.access.isStaff(query.viewer),
    })
  }
}

@QueryHandler(ListDocumentsQuery)
export class ListDocumentsHandler implements IQueryHandler<
  ListDocumentsQuery,
  PaginatedResult<GeneratedDocumentView>
> {
  constructor(
    private readonly documents: GeneratedDocumentRepository,
    private readonly users: UsersFacade,
  ) {}

  execute(
    query: ListDocumentsQuery,
  ): Promise<PaginatedResult<GeneratedDocumentView>> {
    return paginateWith(query.page, async (args) => {
      const [items, total] = await this.documents.list(query.filter, args)
      const users = await this.users.describe(
        items.flatMap((d) => (d.requestedById ? [d.requestedById] : [])),
      )
      return [items.map((d) => toDocumentView(d, users)), total]
    })
  }
}

/**
 * Crea la versión siguiente ya `PENDING` y la encola (responde 202, nunca
 * renderiza en el request). Falla con 404 si la entidad de origen no existe.
 */
@CommandHandler(RegenerateDocumentCommand)
export class RegenerateDocumentHandler implements ICommandHandler<
  RegenerateDocumentCommand,
  GeneratedDocumentView
> {
  constructor(
    private readonly generator: DocumentGenerator,
    private readonly queue: QueuePort,
    private readonly users: UsersFacade,
  ) {}

  async execute(
    command: RegenerateDocumentCommand,
  ): Promise<GeneratedDocumentView> {
    await this.generator.assertSourceExists(command.kind, command.entityId)
    const document = await this.generator.requestRegeneration(
      command.kind,
      command.entityId,
      command.requestedById,
    )
    const payload: DocumentRegeneratePayload = {
      documentId: document.id,
      kind: command.kind,
      entityId: command.entityId,
      requestedById: command.requestedById,
    }
    await this.queue.publish(DOCUMENT_REGENERATE_QUEUE, payload)
    const users = await this.users.describe([command.requestedById])
    return toDocumentView(document, users)
  }
}
