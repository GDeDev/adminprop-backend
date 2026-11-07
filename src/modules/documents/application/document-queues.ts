import { QueueDefinition } from '@/platform/queue/queue.port'
import { DocumentKind } from '../domain/document'

/** Regeneración manual (`POST /documents/:kind/:entityId/regenerate`). */
export const DOCUMENT_REGENERATE_QUEUE: QueueDefinition = {
  name: 'document-regenerate',
  retryLimit: 3,
  retryDelaySeconds: 30,
}

export interface DocumentRegeneratePayload {
  documentId: string
  kind: DocumentKind
  entityId: string
  requestedById: string
}
