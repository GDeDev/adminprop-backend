import { Injectable } from '@nestjs/common'

import { StoragePort } from '@/platform/storage/storage.port'
import { DocumentKind, DocumentStatus } from '../domain/document'
import { GeneratedDocumentRepository } from '../domain/document.ports'

export type PdfLookup =
  | { status: 'READY'; filename: string; content: Buffer; contentType: string }
  /** Todavía no hay una versión lista: conviene esperar un poco. */
  | { status: 'PENDING' }
  /** La generación falló: no hay nada que esperar. */
  | { status: 'UNAVAILABLE' }

const FILENAME: Record<DocumentKind, string> = {
  [DocumentKind.SETTLEMENT]: 'liquidacion.pdf',
  [DocumentKind.OWNER_STATEMENT]: 'consolidado.pdf',
  [DocumentKind.PAYMENT_RECEIPT]: 'recibo.pdf',
  [DocumentKind.TERMINATION_NOTICE]: 'rescision.pdf',
}

/**
 * Lo que otros módulos pueden pedirle a documentos: el PDF vigente de una
 * entidad, para adjuntarlo a un mail (Fase 14, A-59). Corre dentro del tenant
 * del contexto.
 */
@Injectable()
export class DocumentsFacade {
  constructor(
    private readonly documents: GeneratedDocumentRepository,
    private readonly storage: StoragePort,
  ) {}

  async currentPdf(kind: DocumentKind, entityId: string): Promise<PdfLookup> {
    const current = await this.documents.findCurrent(kind, entityId)
    if (current?.storageKey && current.url) {
      return {
        status: 'READY',
        filename: FILENAME[kind],
        content: await this.storage.download(current.storageKey, current.url),
        contentType: 'application/pdf',
      }
    }
    const latest = await this.documents.findLatest(kind, entityId)
    return latest?.status === DocumentStatus.FAILED
      ? { status: 'UNAVAILABLE' }
      : { status: 'PENDING' }
  }
}
