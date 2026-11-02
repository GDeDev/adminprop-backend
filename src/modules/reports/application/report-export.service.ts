import { Injectable } from '@nestjs/common'

import { AuditFacade } from '@/modules/audit/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { ReportExporterPort } from '@/platform/exports/report-exporter.port'
import { PdfRendererPort } from '@/platform/pdf/pdf.port'
import { RequestContext } from '@/shared/context/request-context'
import { todayIso } from '@/shared/dates/calendar-date'
import { Attachment, EXPORT_CONTENT_TYPES } from '@/shared/files/attachment'
import { ReportMeta } from '../domain/reports'
import {
  arrearsTable,
  expiringTable,
  incomeTable,
  paymentsTable,
  propertiesTable,
  ReportBranding,
  servicesTable,
  tablePdf,
} from './report-tables'
import { PaymentsFilter, ReportsService } from './reports.service'

export type ReportFormat = 'xlsx' | 'csv' | 'pdf'

/** Los reportes que se pueden bajar como archivo y sus parámetros. */
export type ExportRequest =
  | { report: 'income'; from?: string; to?: string }
  | ({ report: 'payments' } & PaymentsFilter)
  | { report: 'arrears'; asOf?: string; minDays?: number }
  | { report: 'properties'; status?: 'RENTED' | 'AVAILABLE' }
  | { report: 'expiring-contracts'; withinDays?: number }
  | { report: 'services'; status?: 'overdue' | 'all' }

const FILE_NAMES: Record<ExportRequest['report'], string> = {
  income: 'ingresos',
  payments: 'pagos',
  arrears: 'alquileres-vencidos',
  properties: 'propiedades',
  'expiring-contracts': 'contratos-por-vencer',
  services: 'servicios-vencidos',
}

const DEFAULT_PRIMARY_COLOR = '#c2410c'
const HEX = /^#[0-9a-fA-F]{6}$/
const DEFAULT_FOOTER = 'Documento emitido por el sistema de gestión.'

/**
 * Convierte un reporte en el archivo que se descarga (Fase 19): XLSX y CSV por
 * el `ReportExporterPort`, PDF por el `PdfRendererPort` con la plantilla
 * genérica de tabla. No se guarda en el storage (D-119) y cada descarga queda
 * en la auditoría.
 */
@Injectable()
export class ReportExportService {
  constructor(
    private readonly reports: ReportsService,
    private readonly exporter: ReportExporterPort,
    private readonly pdf: PdfRendererPort,
    private readonly tenants: TenantsFacade,
    private readonly audit: AuditFacade,
  ) {}

  async export(
    request: ExportRequest,
    format: ReportFormat,
  ): Promise<Attachment> {
    const generatedOn = todayIso()
    const { table, meta, rows } = await this.tableOf(request, generatedOn)

    let buffer: Buffer
    if (format === 'xlsx') buffer = await this.exporter.toXlsx(table)
    else if (format === 'csv') buffer = this.exporter.toCsv(table)
    else {
      buffer = await this.pdf.render(
        tablePdf(table, await this.branding(), generatedOn),
      )
    }

    await this.audit.record({
      action: 'EXPORT',
      entity: 'Report',
      summary: `Exportó el reporte "${table.title}" (${rows} filas, ${format.toUpperCase()})`,
      changes: {
        report: { after: request.report },
        format: { after: format },
        filters: { after: meta.filters },
        rows: { after: rows },
      },
    })

    return {
      buffer,
      filename: `${FILE_NAMES[request.report]}-${generatedOn}.${format}`,
      contentType: EXPORT_CONTENT_TYPES[format],
    }
  }

  private async tableOf(request: ExportRequest, generatedOn: string) {
    switch (request.report) {
      case 'income': {
        const report = await this.reports.income(request.from, request.to)
        return {
          table: incomeTable(report, generatedOn),
          meta: report as ReportMeta,
          rows: report.rows.length,
        }
      }
      case 'payments': {
        const report = await this.reports.payments(request)
        return {
          table: paymentsTable(report.rows, report, generatedOn),
          meta: report as ReportMeta,
          rows: report.rows.length,
        }
      }
      case 'arrears': {
        const report = await this.reports.arrears(request.asOf, request.minDays)
        return {
          table: arrearsTable(report, generatedOn),
          meta: report as ReportMeta,
          rows: report.rows.length,
        }
      }
      case 'properties': {
        const report = await this.reports.propertiesReport(request.status)
        return {
          table: propertiesTable(report, generatedOn),
          meta: report as ReportMeta,
          rows: report.rows.length,
        }
      }
      case 'expiring-contracts': {
        const report = await this.reports.expiring(request.withinDays)
        return {
          table: expiringTable(report, generatedOn),
          meta: report as ReportMeta,
          rows: report.rows.length,
        }
      }
      case 'services': {
        const report = await this.reports.servicesReport(request.status)
        return {
          table: servicesTable(report, generatedOn),
          meta: report as ReportMeta,
          rows: report.rows.length,
        }
      }
    }
  }

  /** Marca de la inmobiliaria para el PDF: sin logo (D-120), con su color y datos fiscales. */
  private async branding(): Promise<ReportBranding> {
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Reporte sin inmobiliaria en el contexto')
    const tenant = await this.tenants.branding(tenantId)
    const contact = [tenant.phone, tenant.email].filter(Boolean).join(' - ')
    return {
      brandName: tenant.legalName ?? tenant.name,
      primaryColor:
        tenant.primaryColor && HEX.test(tenant.primaryColor)
          ? tenant.primaryColor
          : DEFAULT_PRIMARY_COLOR,
      detailLines: [
        tenant.taxId ? `CUIT ${tenant.taxId}` : null,
        tenant.address,
        contact || null,
      ].filter((line): line is string => Boolean(line)),
      footerLines: [tenant.documentFooter ?? DEFAULT_FOOTER],
    }
  }
}
