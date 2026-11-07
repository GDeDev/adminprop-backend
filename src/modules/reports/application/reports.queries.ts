import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { Attachment } from '@/shared/files/attachment'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginate, toPageArgs } from '@/shared/pagination/pagination'
import {
  ArrearsReport,
  DashboardReport,
  ExpiringContractsReport,
  IncomeReport,
  PaymentReportRow,
  PropertiesReport,
  ServicesReport,
} from '../domain/reports'
import {
  ExportRequest,
  ReportExportService,
  ReportFormat,
} from './report-export.service'
import { PaymentsFilter, ReportsService } from './reports.service'

export class GetDashboardReportQuery {
  constructor(public readonly period: string | undefined) {}
}

export class GetIncomeReportQuery {
  constructor(
    public readonly from: string | undefined,
    public readonly to: string | undefined,
  ) {}
}

export class GetPaymentsReportQuery {
  constructor(
    public readonly filter: PaymentsFilter,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetArrearsReportQuery {
  constructor(
    public readonly asOf: string | undefined,
    public readonly minDays: number | undefined,
  ) {}
}

export class GetPropertiesReportQuery {
  constructor(public readonly status: 'RENTED' | 'AVAILABLE' | undefined) {}
}

export class GetExpiringContractsReportQuery {
  constructor(public readonly withinDays: number | undefined) {}
}

export class GetServicesReportQuery {
  constructor(public readonly status: 'overdue' | 'all' | undefined) {}
}

export class ExportReportQuery {
  constructor(
    public readonly request: ExportRequest,
    public readonly format: ReportFormat,
  ) {}
}

@QueryHandler(GetDashboardReportQuery)
export class GetDashboardReportHandler implements IQueryHandler<
  GetDashboardReportQuery,
  DashboardReport
> {
  constructor(private readonly reports: ReportsService) {}

  execute(query: GetDashboardReportQuery): Promise<DashboardReport> {
    return this.reports.dashboard(query.period)
  }
}

@QueryHandler(GetIncomeReportQuery)
export class GetIncomeReportHandler implements IQueryHandler<
  GetIncomeReportQuery,
  IncomeReport
> {
  constructor(private readonly reports: ReportsService) {}

  execute(query: GetIncomeReportQuery): Promise<IncomeReport> {
    return this.reports.income(query.from, query.to)
  }
}

@QueryHandler(GetPaymentsReportQuery)
export class GetPaymentsReportHandler implements IQueryHandler<
  GetPaymentsReportQuery,
  PaginatedResult<PaymentReportRow>
> {
  constructor(private readonly reports: ReportsService) {}

  async execute(
    query: GetPaymentsReportQuery,
  ): Promise<PaginatedResult<PaymentReportRow>> {
    const { rows } = await this.reports.payments(query.filter)
    const { skip, take } = toPageArgs(query.page)
    return paginate(rows.slice(skip, skip + take), rows.length, query.page)
  }
}

@QueryHandler(GetArrearsReportQuery)
export class GetArrearsReportHandler implements IQueryHandler<
  GetArrearsReportQuery,
  ArrearsReport
> {
  constructor(private readonly reports: ReportsService) {}

  execute(query: GetArrearsReportQuery): Promise<ArrearsReport> {
    return this.reports.arrears(query.asOf, query.minDays)
  }
}

@QueryHandler(GetPropertiesReportQuery)
export class GetPropertiesReportHandler implements IQueryHandler<
  GetPropertiesReportQuery,
  PropertiesReport
> {
  constructor(private readonly reports: ReportsService) {}

  execute(query: GetPropertiesReportQuery): Promise<PropertiesReport> {
    return this.reports.propertiesReport(query.status)
  }
}

@QueryHandler(GetExpiringContractsReportQuery)
export class GetExpiringContractsReportHandler implements IQueryHandler<
  GetExpiringContractsReportQuery,
  ExpiringContractsReport
> {
  constructor(private readonly reports: ReportsService) {}

  execute(
    query: GetExpiringContractsReportQuery,
  ): Promise<ExpiringContractsReport> {
    return this.reports.expiring(query.withinDays)
  }
}

@QueryHandler(GetServicesReportQuery)
export class GetServicesReportHandler implements IQueryHandler<
  GetServicesReportQuery,
  ServicesReport
> {
  constructor(private readonly reports: ReportsService) {}

  execute(query: GetServicesReportQuery): Promise<ServicesReport> {
    return this.reports.servicesReport(query.status)
  }
}

@QueryHandler(ExportReportQuery)
export class ExportReportHandler implements IQueryHandler<
  ExportReportQuery,
  Attachment
> {
  constructor(private readonly exporter: ReportExportService) {}

  execute(query: ExportReportQuery): Promise<Attachment> {
    return this.exporter.export(query.request, query.format)
  }
}
