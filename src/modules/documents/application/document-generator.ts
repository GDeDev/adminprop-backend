import { isDeepStrictEqual } from 'node:util'

import { Injectable } from '@nestjs/common'

import { PdfRendererPort } from '@/platform/pdf/pdf.port'
import { StoragePort } from '@/platform/storage/storage.port'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { RequestContext } from '@/shared/context/request-context'
import { IsoDate, todayIso } from '@/shared/dates/calendar-date'
import { errorMessage } from '@/shared/core/error-message'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  DocumentData,
  DocumentKind,
  DocumentStatus,
  ENTITY_TYPE,
  GeneratedDocument,
  OwnerStatementDocumentData,
  PaymentReceiptDocumentData,
  SettlementDocumentData,
  STORAGE_FOLDER,
  TerminationNoticeDocumentData,
} from '../domain/document'
import { GeneratedDocumentRepository } from '../domain/document.ports'
import {
  DocumentNotApplicableException,
  DocumentNotFoundException,
} from '../domain/document.exceptions'
import { ownerStatementTemplate } from './templates/owner-statement.template'
import { paymentReceiptTemplate } from './templates/payment-receipt.template'
import { settlementTemplate } from './templates/settlement.template'
import { terminationNoticeTemplate } from './templates/termination-notice.template'
import { DocumentBranding } from './templates/layout'
import { PdfDocumentDefinition } from '@/platform/pdf/pdf.port'
import { DocumentBrandingResolver } from './document-branding'
import { DocumentDataBuilder } from './document-data.builder'

export interface GenerateRequest {
  kind: DocumentKind
  entityId: string
  /** Una versión ya creada (regeneración manual): se rellena en vez de crear otra. */
  documentId?: string
  requestedById?: string | null
  /** Regenerar aunque el último `READY` tenga los mismos datos. */
  force?: boolean
}

/** Elige la plantilla de cada tipo (pura: se testea sin renderizar). */
export function renderDefinition(
  kind: DocumentKind,
  data: DocumentData,
  branding: DocumentBranding,
  generatedOn: IsoDate,
): PdfDocumentDefinition {
  switch (kind) {
    case DocumentKind.SETTLEMENT:
      return settlementTemplate(
        data as SettlementDocumentData,
        branding,
        generatedOn,
      )
    case DocumentKind.OWNER_STATEMENT:
      return ownerStatementTemplate(
        data as OwnerStatementDocumentData,
        branding,
        generatedOn,
      )
    case DocumentKind.PAYMENT_RECEIPT:
      return paymentReceiptTemplate(
        data as PaymentReceiptDocumentData,
        branding,
        generatedOn,
      )
    case DocumentKind.TERMINATION_NOTICE:
      return terminationNoticeTemplate(
        data as TerminationNoticeDocumentData,
        branding,
        generatedOn,
      )
  }
}

/**
 * Arma, renderiza, sube y avisa al módulo dueño (Fase 15, 3). Idempotente por
 * `data_snapshot`: un evento repetido con los mismos datos no genera otra
 * versión. Una versión nueva nunca pisa el archivo de la anterior.
 */
@Injectable()
export class DocumentGenerator {
  constructor(
    private readonly documents: GeneratedDocumentRepository,
    private readonly builder: DocumentDataBuilder,
    private readonly branding: DocumentBrandingResolver,
    private readonly renderer: PdfRendererPort,
    private readonly storage: StoragePort,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Null si el documento no aplica a esa entidad (un pago sin recibo). */
  async generate(request: GenerateRequest): Promise<GeneratedDocument | null> {
    const tenantId = this.tenantId()
    const data = await this.builder.build(request.kind, request.entityId)
    if (!data) return null

    const document = await this.prepare(request, data)
    if (document.status === DocumentStatus.READY) return document

    const definition = renderDefinition(
      request.kind,
      data,
      await this.branding.resolve(tenantId),
      todayIso(),
    )
    const buffer = await this.renderer.render(definition)
    const stored = await this.storage.upload(
      buffer,
      `documents/${STORAGE_FOLDER[request.kind]}/${request.entityId}-${document.version}.pdf`,
      { contentType: 'application/pdf', access: 'private' },
    )

    return this.prisma.transaction(async () => {
      await this.builder.attach(request.kind, request.entityId, stored)
      return this.documents.markReady(document.id, {
        storageKey: stored.key,
        url: stored.url,
        sizeBytes: buffer.length,
        generatedAt: new Date(),
        dataSnapshot: data,
      })
    })
  }

  /** 404 si la entidad no existe; 422 si no genera ese documento. */
  async assertSourceExists(
    kind: DocumentKind,
    entityId: string,
  ): Promise<void> {
    const data = await this.builder.build(kind, entityId)
    if (!data) {
      throw new DocumentNotApplicableException(
        'esa entidad no emite este documento',
      )
    }
  }

  /** Crea la versión siguiente de una regeneración manual, ya `PENDING`. */
  async requestRegeneration(
    kind: DocumentKind,
    entityId: string,
    requestedById: string | null,
  ): Promise<GeneratedDocument> {
    const latest = await this.documents.findLatest(kind, entityId)
    return this.documents.create({
      kind,
      entityId,
      version: (latest?.version ?? 0) + 1,
      requestedById,
      dataSnapshot: null,
    })
  }

  /**
   * Deja la marca de fallo definitivo (reintentos agotados) y avisa al
   * personal (`DOCUMENT_FAILED`, una vez por versión).
   */
  async fail(
    kind: DocumentKind,
    entityId: string,
    error: unknown,
    documentId?: string,
  ): Promise<void> {
    const tenantId = this.tenantId()
    const message = errorMessage(error).slice(0, 1000)
    let document: GeneratedDocument | null = documentId
      ? await this.documents.findById(documentId)
      : await this.documents.findLatest(kind, entityId)
    if (!document || document.status === DocumentStatus.READY) {
      document = await this.documents.create({
        kind,
        entityId,
        version: (document?.version ?? 0) + 1,
        requestedById: null,
        dataSnapshot: null,
      })
    }
    await this.documents.markFailed(document.id, message)
    await this.notifications.notifyStaff({
      tenantId,
      type: 'DOCUMENT_FAILED',
      title: 'No se pudo generar un PDF',
      body: `Falló la generación del documento (${kind}): ${message}`,
      dedupeKey: `DOCUMENT_FAILED:${document.id}`,
      entity: { type: ENTITY_TYPE[kind], id: entityId },
    })
  }

  /** Reusa una versión pendiente o fallida, o crea la siguiente. */
  private async prepare(
    request: GenerateRequest,
    data: DocumentData,
  ): Promise<GeneratedDocument> {
    const requestedById = request.requestedById ?? null
    if (request.documentId) {
      const existing = await this.documents.findById(request.documentId)
      if (!existing) throw new DocumentNotFoundException()
      return this.documents.reset(existing.id, requestedById)
    }
    const latest = await this.documents.findLatest(
      request.kind,
      request.entityId,
    )
    if (latest) {
      if (
        latest.status === DocumentStatus.READY &&
        !request.force &&
        isDeepStrictEqual(latest.dataSnapshot, JSON.parse(JSON.stringify(data)))
      ) {
        return latest
      }
      if (latest.status !== DocumentStatus.READY) {
        return this.documents.reset(latest.id, requestedById)
      }
    }
    return this.documents.create({
      kind: request.kind,
      entityId: request.entityId,
      version: (latest?.version ?? 0) + 1,
      requestedById,
      dataSnapshot: data,
    })
  }

  private tenantId(): string {
    const tenantId = RequestContext.tenantId
    if (!tenantId)
      throw new Error('Generación de documentos fuera de un tenant')
    return tenantId
  }
}
