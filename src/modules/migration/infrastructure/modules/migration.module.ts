import { Module } from '@nestjs/common'

import { AuditRecorderModule } from '@/modules/audit/public'
import { ContractsModule } from '@/modules/contracts/public'
import { JobsModule } from '@/modules/jobs/public'
import { MasterDataModule } from '@/modules/master-data/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { AnalysisRunner } from '../../application/analysis-runner'
import { AssetMigrator } from '../../application/asset-migrator'
import { BatchDiscarder } from '../../application/batch-discarder'
import { ImportBatchViews } from '../../application/batch.views'
import { ExcelReader } from '../../application/excel-reader'
import { ExcelTemplateService } from '../../application/excel-template.service'
import { ImportAnalyzer } from '../../application/import-analyzer'
import { ImportExecutor } from '../../application/import-executor'
import { ImportReportService } from '../../application/import-report.service'
import {
  ConfirmImportHandler,
  DiscardImportHandler,
  GetExcelTemplateHandler,
  GetImportBatchHandler,
  GetImportReportHandler,
  ListImportBatchesHandler,
  ListImportRowsHandler,
  RetryImportAssetsHandler,
  StartExcelAnalysisHandler,
  StartTokkoAnalysisHandler,
  UpdateImportRowHandler,
} from '../../application/migration.handlers'
import { ReferenceDataLoader } from '../../application/reference-data'
import {
  ImportAssetRepository,
  ImportBatchRepository,
  ImportLinkRepository,
  ImportRowRepository,
} from '../../domain/migration.ports'
import { MigrationFacade } from '../../public/migration.facade'
import { MigrationConsumer } from '../consumers/migration.consumer'
import { MigrationController } from '../http/controllers/migration.controller'
import { ImportAssetRepositoryImpl } from '../repositories/import-asset.repository.impl'
import { ImportBatchRepositoryImpl } from '../repositories/import-batch.repository.impl'
import { ImportLinkRepositoryImpl } from '../repositories/import-link.repository.impl'
import { ImportRowRepositoryImpl } from '../repositories/import-row.repository.impl'

/**
 * Migración de datos (Fase 21): importa desde un Excel o desde Tokko en dos
 * pasos sobre el mismo lote. No toca tablas de otros módulos: crea cada
 * entidad por la facade de su módulo, con las mismas validaciones que la carga
 * manual.
 *
 * `UsersFacade` viene del módulo de auth, que es global.
 */
@Module({
  imports: [
    OwnersModule,
    RentersModule,
    PropertiesModule,
    ContractsModule,
    MasterDataModule,
    JobsModule,
    AuditRecorderModule,
  ],
  controllers: [MigrationController],
  providers: [
    { provide: ImportBatchRepository, useClass: ImportBatchRepositoryImpl },
    { provide: ImportRowRepository, useClass: ImportRowRepositoryImpl },
    { provide: ImportLinkRepository, useClass: ImportLinkRepositoryImpl },
    { provide: ImportAssetRepository, useClass: ImportAssetRepositoryImpl },
    ReferenceDataLoader,
    ExcelReader,
    ExcelTemplateService,
    ImportAnalyzer,
    ImportExecutor,
    AnalysisRunner,
    AssetMigrator,
    BatchDiscarder,
    ImportReportService,
    ImportBatchViews,
    MigrationConsumer,
    MigrationFacade,
    StartExcelAnalysisHandler,
    StartTokkoAnalysisHandler,
    UpdateImportRowHandler,
    ConfirmImportHandler,
    DiscardImportHandler,
    RetryImportAssetsHandler,
    ListImportBatchesHandler,
    GetImportBatchHandler,
    ListImportRowsHandler,
    GetExcelTemplateHandler,
    GetImportReportHandler,
  ],
  exports: [MigrationFacade],
})
export class MigrationModule {}
