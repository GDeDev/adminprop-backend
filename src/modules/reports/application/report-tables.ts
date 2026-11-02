import { ExportTable } from '@/platform/exports/report-exporter.port'
import { PdfBlock, PdfDocumentDefinition } from '@/platform/pdf/pdf.port'
import { addMoney, toMoneyString } from '@/shared/money'
import {
  ArrearsReport,
  CurrencyAmount,
  ExpiringContractsReport,
  IncomeReport,
  PaymentReportRow,
  PropertiesReport,
  ReportCurrency,
  ReportMeta,
  ServicesReport,
} from '../domain/reports'
import { sumByCurrency } from '../domain/report-calculations'

const METHODS: Record<string, string> = {
  TRANSFER: 'Transferencia',
  CASH: 'Efectivo',
  CREDIT: 'Saldo a favor',
  OTHER: 'Otro',
  DEPOSIT: 'Depósito',
}
const RECEIVERS: Record<string, string> = {
  AGENCY: 'Inmobiliaria',
  OWNER: 'Propietario',
}
const PROPERTY_STATUS: Record<string, string> = {
  RENTED: 'Alquilada',
  AVAILABLE: 'Disponible',
  OTHER: 'Otro estado',
}

const CURRENCIES: ReportCurrency[] = ['ARS', 'USD']

/** Etiquetas del encabezado del archivo para los filtros pedidos. */
const FILTER_LABELS: Record<string, string> = {
  from: 'Desde',
  to: 'Hasta',
  ownerId: 'Propietario (id)',
  propertyId: 'Propiedad (id)',
  renterId: 'Inquilino (id)',
  asOf: 'A la fecha',
  minDays: 'Atraso mínimo (días)',
  status: 'Estado',
  withinDays: 'Vencen dentro de (días)',
}

function metaOf(report: ReportMeta, generatedOn: string): [string, string][] {
  return [
    ['Generado', generatedOn],
    ...Object.entries(report.filters)
      .filter(([, value]) => value !== null && value !== '')
      .map(
        ([key, value]) =>
          [FILTER_LABELS[key] ?? key, String(value)] as [string, string],
      ),
  ]
}

const amountIn = (
  amounts: CurrencyAmount[],
  currency: ReportCurrency,
): string => amounts.find((a) => a.currency === currency)?.amount ?? '0.00'

export function incomeTable(
  report: IncomeReport,
  generatedOn: string,
): ExportTable {
  const money = (header: string) => ({
    header,
    kind: 'money' as const,
    width: 18,
  })
  const columns = [
    { header: 'Mes', width: 10 },
    { header: 'Moneda', width: 9 },
    money('Alquiler cobrado'),
    money('Punitorios cobrados'),
    money('Cargos cobrados'),
    money('Honorarios devengados'),
    money('Honorarios cobrados'),
    money('Neto liquidado'),
    money('Neto transferido'),
  ]
  const fields = [
    'rentCollected',
    'lateFeesCollected',
    'chargesCollected',
    'feesAccrued',
    'feesCollected',
    'netSettled',
    'netTransferred',
  ] as const
  return {
    title: 'Ingresos y honorarios',
    meta: metaOf(report, generatedOn),
    columns,
    rows: report.rows.map((row) => [
      row.period,
      row.currency,
      ...fields.map((field) => row[field]),
    ]),
    totalRows: CURRENCIES.flatMap((currency) => {
      const rows = report.rows.filter((row) => row.currency === currency)
      if (rows.length === 0) return []
      return [
        [
          'Total',
          currency,
          ...fields.map((field) =>
            toMoneyString(addMoney('0', ...rows.map((row) => row[field]))),
          ),
        ],
      ]
    }),
  }
}

export function paymentsTable(
  rows: PaymentReportRow[],
  report: ReportMeta,
  generatedOn: string,
): ExportTable {
  return {
    title: 'Pagos recibidos',
    meta: metaOf(report, generatedOn),
    columns: [
      { header: 'Fecha de pago', width: 14 },
      { header: 'Cuota', width: 10 },
      { header: 'Inquilino', width: 28 },
      { header: 'Propiedad', width: 32 },
      { header: 'Propietario', width: 28 },
      { header: 'Importe', kind: 'money', width: 16 },
      { header: 'Moneda', width: 9 },
      { header: 'Medio', width: 16 },
      { header: 'Recibió', width: 14 },
    ],
    rows: rows.map((row) => [
      row.paidAt,
      row.period,
      row.renterName,
      row.propertyAddress,
      row.ownerName,
      row.amount,
      row.currency,
      METHODS[row.method] ?? row.method,
      RECEIVERS[row.receivedBy] ?? row.receivedBy,
    ]),
    totalRows: sumByCurrency(
      rows.map((row) => ({ currency: row.currency, amount: row.amount })),
    ).map((total) => [
      'Total',
      '',
      '',
      '',
      '',
      total.amount,
      total.currency,
      '',
      '',
    ]),
  }
}

export function arrearsTable(
  report: ArrearsReport,
  generatedOn: string,
): ExportTable {
  return {
    title: 'Alquileres vencidos',
    meta: metaOf(report, generatedOn),
    columns: [
      { header: 'Inquilino', width: 28 },
      { header: 'Teléfono', width: 16 },
      { header: 'Propiedad', width: 32 },
      { header: 'Propietario', width: 28 },
      { header: 'Cuotas vencidas', kind: 'integer', width: 12 },
      { header: 'Días de atraso (máx.)', kind: 'integer', width: 14 },
      { header: 'Saldo ARS', kind: 'money', width: 16 },
      { header: 'Saldo USD', kind: 'money', width: 16 },
      { header: 'Punitorio ARS', kind: 'money', width: 16 },
      { header: 'Punitorio USD', kind: 'money', width: 16 },
    ],
    rows: report.rows.map((row) => [
      row.renterName,
      row.renterPhone,
      row.propertyAddress,
      row.ownerName,
      String(row.overdueInstallments),
      String(row.maxDaysOverdue),
      amountIn(row.balance, 'ARS'),
      amountIn(row.balance, 'USD'),
      amountIn(row.lateFee, 'ARS'),
      amountIn(row.lateFee, 'USD'),
    ]),
    totalRows: [
      [
        'Total',
        '',
        '',
        '',
        '',
        '',
        amountIn(report.totals, 'ARS'),
        amountIn(report.totals, 'USD'),
        amountIn(
          sumByCurrency(report.rows.flatMap((row) => row.lateFee)),
          'ARS',
        ),
        amountIn(
          sumByCurrency(report.rows.flatMap((row) => row.lateFee)),
          'USD',
        ),
      ],
    ],
  }
}

export function propertiesTable(
  report: PropertiesReport,
  generatedOn: string,
): ExportTable {
  return {
    title: 'Propiedades',
    meta: metaOf(report, generatedOn),
    columns: [
      { header: 'Propiedad', width: 36 },
      { header: 'Estado', width: 14 },
      { header: 'Inquilino', width: 28 },
      { header: 'Alquiler', kind: 'money', width: 16 },
      { header: 'Moneda', width: 9 },
      { header: 'Fin del contrato', width: 16 },
      { header: 'Días sin alquilar', kind: 'integer', width: 14 },
    ],
    rows: report.rows.map((row) => [
      row.address,
      PROPERTY_STATUS[row.status] ?? row.status,
      row.renterName,
      row.rent?.amount ?? null,
      row.rent?.currency ?? null,
      row.contractEndDate,
      row.daysVacant === null ? null : String(row.daysVacant),
    ]),
  }
}

export function expiringTable(
  report: ExpiringContractsReport,
  generatedOn: string,
): ExportTable {
  return {
    title: 'Contratos por vencer',
    meta: metaOf(report, generatedOn),
    columns: [
      { header: 'Propiedad', width: 36 },
      { header: 'Inquilino', width: 28 },
      { header: 'Fin del contrato', width: 16 },
      { header: 'Días restantes', kind: 'integer', width: 14 },
      { header: 'Renovación en curso', width: 18 },
    ],
    rows: report.rows.map((row) => [
      row.propertyAddress,
      row.renterName,
      row.endDate,
      String(row.daysLeft),
      row.renewalInProgress ? 'Sí' : 'No',
    ]),
  }
}

export function servicesTable(
  report: ServicesReport,
  generatedOn: string,
): ExportTable {
  return {
    title: 'Servicios vencidos',
    meta: metaOf(report, generatedOn),
    columns: [
      { header: 'Propiedad', width: 36 },
      { header: 'Servicio', width: 26 },
      { header: 'Días de atraso', kind: 'integer', width: 14 },
    ],
    rows: report.rows.map((row) => [
      row.propertyAddress,
      row.serviceName,
      String(row.daysOverdue),
    ]),
  }
}

// ----------------------------------------------------------------- PDF

/** La marca que lleva el encabezado del PDF de un reporte. */
export interface ReportBranding {
  brandName: string
  primaryColor: string
  detailLines: string[]
  footerLines: string[]
}

/** `1234567.5` -> `1.234.567,50`, por texto para no perder centavos. */
export function formatAmountEs(amount: string): string {
  const fixed = toMoneyString(amount)
  const negative = fixed.startsWith('-')
  const [integer, decimals] = (negative ? fixed.slice(1) : fixed).split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negative ? '-' : ''}${grouped},${decimals}`
}

/**
 * Plantilla genérica de tabla (Fase 19): título, filtros aplicados, columnas
 * y totales, en hoja apaisada y con la marca de la inmobiliaria. Sirve a
 * todos los reportes; el contenido lo arman las funciones de arriba.
 */
export function tablePdf(
  table: ExportTable,
  branding: ReportBranding,
  generatedOn: string,
): PdfDocumentDefinition {
  const format = (kind: string | undefined, cell: string | number | null) => {
    if (cell === null) return ''
    if (kind === 'money' && typeof cell === 'string' && cell !== '') {
      return formatAmountEs(cell)
    }
    return String(cell)
  }
  const rowOf = (cells: (string | number | null)[]) =>
    table.columns.map((column, index) => format(column.kind, cells[index]))

  const blocks: PdfBlock[] = [
    { type: 'title', text: table.title },
    {
      type: 'keyValues',
      rows: table.meta.map(([label, value]) => ({ label, value })),
    },
    { type: 'spacer' },
    {
      type: 'table',
      table: {
        columns: table.columns.map((column) => ({
          header: column.header,
          align:
            column.kind === 'money' || column.kind === 'integer'
              ? ('right' as const)
              : ('left' as const),
          width: '*' as const,
        })),
        rows: table.rows.map(rowOf),
        totalRows: (table.totalRows ?? []).map(rowOf),
        emptyText: 'No hay datos para los filtros elegidos',
      },
    },
  ]
  return {
    title: table.title,
    landscape: true,
    header: {
      brandName: branding.brandName,
      primaryColor: branding.primaryColor,
      detailLines: branding.detailLines,
    },
    blocks,
    footerLines: [
      ...branding.footerLines,
      `Reporte generado el ${generatedOn}`,
    ],
  }
}
