/**
 * API pública de documentos: los demás módulos le piden un PDF publicando el
 * evento correspondiente en su cola; los portales lo bajan por
 * `GET /documents/:kind/:entityId`; y el mail lo adjunta con `DocumentsFacade`.
 */
export { DocumentsModule } from '../infrastructure/modules/documents.module'
export { DocumentKind, DocumentStatus } from '../domain/document'
export { DocumentsFacade } from './documents.facade'
export type { PdfLookup } from './documents.facade'
