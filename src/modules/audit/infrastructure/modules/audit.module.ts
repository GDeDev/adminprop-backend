import { Module } from '@nestjs/common'

import { ContractsModule } from '@/modules/contracts/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { AuditNameResolver } from '../../application/audit-name-resolver'
import { AuditSummarizer } from '../../application/audit-summarizer'
import {
  ExportAuditHandler,
  GetAuditCatalogHandler,
  GetAuditEntryHandler,
  ListAuditHandler,
  ListEntityHistoryHandler,
} from '../../application/audit.queries'
import { AuditViews } from '../../application/audit.views'
import { AuditLogRepository } from '../../domain/audit'
import { AuditController } from '../http/controllers/audit.controller'
import { AuditLogRepositoryImpl } from '../repositories/audit-log.repository.impl'
import { AuditRecorderModule } from './audit-recorder.module'

/**
 * Auditoría y trazabilidad (Fase 20): la pantalla del admin. Lee `audit_logs`
 * y resuelve nombres por las facades de propiedades, propietarios,
 * inquilinos, contratos y usuarios (auth es global). Escribir es otra cosa:
 * `AuditRecorderModule`.
 */
@Module({
  imports: [
    AuditRecorderModule,
    PropertiesModule,
    OwnersModule,
    RentersModule,
    ContractsModule,
  ],
  controllers: [AuditController],
  providers: [
    { provide: AuditLogRepository, useClass: AuditLogRepositoryImpl },
    AuditNameResolver,
    AuditSummarizer,
    AuditViews,
    ListAuditHandler,
    GetAuditEntryHandler,
    GetAuditCatalogHandler,
    ListEntityHistoryHandler,
    ExportAuditHandler,
  ],
})
export class AuditModule {}
