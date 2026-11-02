import { Global, Module } from '@nestjs/common'

import { ExceljsReportExporter } from './adapters/exceljs.report-exporter'
import { ReportExporterPort } from './report-exporter.port'

/**
 * Registra el `ReportExporterPort` (Fase 19). Hoy sólo existe el adapter
 * `exceljs`; es global para que reportes y auditoría lo inyecten sin importar
 * nada.
 */
@Global()
@Module({
  providers: [
    {
      provide: ReportExporterPort,
      useFactory: (): ReportExporterPort => new ExceljsReportExporter(),
    },
  ],
  exports: [ReportExporterPort],
})
export class ExportsModule {}
