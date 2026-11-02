/**
 * API pública de documentos: nadie la importa salvo `app.module`. Los demás
 * módulos le piden un PDF publicando el evento correspondiente en su cola; los
 * portales lo bajan por `GET /documents/:kind/:entityId`.
 */
export { DocumentsModule } from '../infrastructure/modules/documents.module'
export { DocumentKind, DocumentStatus } from '../domain/document'
