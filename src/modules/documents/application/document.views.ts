import { UserRef } from '@/modules/auth/public'
import {
  DocumentKind,
  DocumentStatus,
  GeneratedDocument,
} from '../domain/document'

/** `GeneratedDocumentDto`. */
export interface GeneratedDocumentView {
  id: string
  kind: DocumentKind
  entityId: string
  version: number
  status: DocumentStatus
  url: string | null
  sizeBytes: number | null
  error: string | null
  generatedAt: Date | null
  requestedBy: UserRef | null
  createdAt: Date
}

export function toDocumentView(
  document: GeneratedDocument,
  users: Map<string, UserRef>,
  options: { hideError?: boolean } = {},
): GeneratedDocumentView {
  return {
    id: document.id,
    kind: document.kind,
    entityId: document.entityId,
    version: document.version,
    status: document.status,
    url: document.url,
    sizeBytes: document.sizeBytes,
    error: options.hideError ? null : document.error,
    generatedAt: document.generatedAt,
    requestedBy: document.requestedById
      ? (users.get(document.requestedById) ?? null)
      : null,
    createdAt: document.createdAt,
  }
}
