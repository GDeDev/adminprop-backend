import { Module } from '@nestjs/common'

import { BillingModule } from '@/modules/billing/public'
import { ContractsModule } from '@/modules/contracts/public'
import { OwnersModule } from '@/modules/owners/public'
import { RentersModule } from '@/modules/renters/public'
import { SettlementsModule } from '@/modules/settlements/public'
import { TenantsModule } from '@/modules/tenants/public'
import { DocumentAccess } from '../../application/document-access'
import { DocumentBrandingResolver } from '../../application/document-branding'
import { DocumentDataBuilder } from '../../application/document-data.builder'
import { DocumentGenerator } from '../../application/document-generator'
import {
  GetDocumentHandler,
  ListDocumentsHandler,
  RegenerateDocumentHandler,
} from '../../application/document.handlers'
import { GeneratedDocumentRepository } from '../../domain/document.ports'
import { DocumentEventsConsumer } from '../consumers/document-events.consumer'
import { DocumentsController } from '../http/controllers/documents.controller'
import { GeneratedDocumentRepositoryImpl } from '../repositories/generated-document.repository.impl'

/**
 * PDFs (Fase 15). Escucha los eventos de liquidaciones, cobros y contratos,
 * arma el documento con sus facades y le avisa al módulo dueño. Nadie lo
 * importa: sólo `app.module`.
 */
@Module({
  imports: [
    SettlementsModule,
    BillingModule,
    ContractsModule,
    OwnersModule,
    RentersModule,
    TenantsModule,
  ],
  controllers: [DocumentsController],
  providers: [
    {
      provide: GeneratedDocumentRepository,
      useClass: GeneratedDocumentRepositoryImpl,
    },
    DocumentDataBuilder,
    DocumentBrandingResolver,
    DocumentGenerator,
    DocumentAccess,
    DocumentEventsConsumer,
    GetDocumentHandler,
    ListDocumentsHandler,
    RegenerateDocumentHandler,
  ],
})
export class DocumentsModule {}
