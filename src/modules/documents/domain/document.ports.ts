import {
  DocumentData,
  DocumentKind,
  DocumentStatus,
  GeneratedDocument,
} from './document'

export interface NewGeneratedDocument {
  kind: DocumentKind
  entityId: string
  version: number
  requestedById: string | null
  dataSnapshot: DocumentData | null
}

export interface DocumentFilter {
  kind?: DocumentKind
  entityId?: string
  status?: DocumentStatus
}

export interface ReadyFile {
  storageKey: string
  url: string
  sizeBytes: number
  generatedAt: Date
  dataSnapshot: DocumentData
}

/**
 * Puerto del repositorio. Todo corre dentro del tenant del contexto; las
 * versiones nunca se borran.
 */
export abstract class GeneratedDocumentRepository {
  abstract create(data: NewGeneratedDocument): Promise<GeneratedDocument>

  abstract findById(id: string): Promise<GeneratedDocument | null>

  /** La versión más nueva de la entidad, en cualquier estado. */
  abstract findLatest(
    kind: DocumentKind,
    entityId: string,
  ): Promise<GeneratedDocument | null>

  /** La vigente: la última `READY`. */
  abstract findCurrent(
    kind: DocumentKind,
    entityId: string,
  ): Promise<GeneratedDocument | null>

  /** Vuelve una versión `FAILED` o `PENDING` a `PENDING` para reintentarla. */
  abstract reset(
    id: string,
    requestedById: string | null,
  ): Promise<GeneratedDocument>

  abstract markReady(id: string, file: ReadyFile): Promise<GeneratedDocument>

  abstract markFailed(id: string, error: string): Promise<GeneratedDocument>

  /** Más nuevas primero. */
  abstract list(
    filter: DocumentFilter,
    page: { skip: number; take: number },
  ): Promise<[GeneratedDocument[], number]>
}
