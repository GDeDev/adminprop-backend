import { Module } from '@nestjs/common'

import { AuditRecorderModule } from '@/modules/audit/public'
import { AutomationsModule } from '@/modules/automations/public'
import { BillingModule } from '@/modules/billing/public'
import { ContractsModule } from '@/modules/contracts/public'
import { MasterDataModule } from '@/modules/master-data/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { ServicesModule } from '@/modules/services/public'
import { SettlementsModule } from '@/modules/settlements/public'
import { TenantsModule } from '@/modules/tenants/public'
import { ReportExportService } from '../../application/report-export.service'
import {
  ExportReportHandler,
  GetArrearsReportHandler,
  GetDashboardReportHandler,
  GetExpiringContractsReportHandler,
  GetIncomeReportHandler,
  GetPaymentsReportHandler,
  GetPropertiesReportHandler,
  GetServicesReportHandler,
} from '../../application/reports.queries'
import { ReportsService } from '../../application/reports.service'
import { ReportsController } from '../http/controllers/reports.controller'

/**
 * Estadísticas y reportes (Fase 19). Sin tablas ni repositorios: compone las
 * facades de cobros, liquidaciones, contratos, propiedades, servicios,
 * propietarios, inquilinos, maestros, inmobiliarias y automatizaciones.
 * Nadie lo importa salvo `app.module`.
 */
@Module({
  imports: [
    BillingModule,
    SettlementsModule,
    ContractsModule,
    PropertiesModule,
    ServicesModule,
    OwnersModule,
    RentersModule,
    MasterDataModule,
    TenantsModule,
    AutomationsModule,
    AuditRecorderModule,
  ],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportExportService,
    GetDashboardReportHandler,
    GetIncomeReportHandler,
    GetPaymentsReportHandler,
    GetArrearsReportHandler,
    GetPropertiesReportHandler,
    GetExpiringContractsReportHandler,
    GetServicesReportHandler,
    ExportReportHandler,
  ],
})
export class ReportsModule {}
