import { PdfBlock, PdfDocumentDefinition } from '@/platform/pdf/pdf.port'
import { IsoDate } from '@/shared/dates/calendar-date'
import { SettlementDocumentData } from '../../domain/document'
import {
  ADJUSTMENT_LABEL,
  FEE_MODE_LABEL,
  METHOD_LABEL,
  formatDate,
  formatMoney,
  formatPercentage,
  formatPeriod,
  label,
} from './format'
import { buildDocument, DocumentBranding } from './layout'

/** PDF-01: la liquidación al propietario. */
export function settlementTemplate(
  data: SettlementDocumentData,
  branding: DocumentBranding,
  generatedOn: IsoDate,
): PdfDocumentDefinition {
  const money = (amount: string) => formatMoney(amount, data.currency)
  const blocks: PdfBlock[] = [
    {
      type: 'title',
      text: `Liquidación n.º ${data.sequence}`,
      subtitle: formatPeriod(data.period),
    },
    {
      type: 'keyValues',
      rows: [
        {
          label: 'Propietario',
          value: data.owner
            ? `${data.owner.name}${data.owner.nationalId ? ` (${data.owner.nationalId})` : ''}`
            : '-',
        },
        { label: 'Propiedad', value: data.property ?? '-' },
        { label: 'Inquilino', value: data.renter ?? '-' },
        {
          label: 'Confirmada',
          value: data.confirmedAt ? formatDate(data.confirmedAt) : 'Pendiente',
        },
      ],
    },
    { type: 'heading', text: 'Pagos incluidos' },
    {
      type: 'table',
      table: {
        columns: [
          { header: 'Cuota', width: '*' },
          { header: 'Fecha de pago', width: 'auto' },
          { header: 'Alquiler', align: 'right', width: 'auto' },
          { header: 'Punitorio', align: 'right', width: 'auto' },
          { header: 'Cargos', align: 'right', width: 'auto' },
        ],
        rows: data.payments.map((p) => [
          formatPeriod(p.installmentPeriod),
          formatDate(p.paidAt),
          money(p.rent),
          money(p.lateFee),
          money(p.charges),
        ]),
        totalRows: [
          [
            'Total',
            '',
            money(data.rentTotal),
            money(data.lateFeeTotal),
            money(data.ownerChargesTotal),
          ],
        ],
        emptyText: 'Sin pagos incluidos',
      },
    },
    { type: 'heading', text: 'Honorarios de administración' },
    {
      type: 'keyValues',
      rows: [
        { label: 'Base', value: money(data.fee.base) },
        { label: 'Porcentaje', value: formatPercentage(data.fee.percentage) },
        ...(data.fee.fixedAmount
          ? [{ label: 'Monto fijo', value: money(data.fee.fixedAmount) }]
          : []),
        { label: 'Modalidad', value: label(FEE_MODE_LABEL, data.fee.mode) },
        {
          label: data.fee.deducted ? 'Honorarios (descontados)' : 'Honorarios',
          value: money(data.fee.total),
          emphasis: true,
        },
      ],
    },
    ...(data.fee.mixedTerms
      ? [
          {
            type: 'paragraph' as const,
            muted: true,
            text: 'Las cuotas incluidas tenían condiciones de honorarios distintas; el total suma cada cuota con las suyas.',
          },
        ]
      : []),
    { type: 'heading', text: 'Gastos adelantados' },
    {
      type: 'table',
      table: {
        columns: [
          { header: 'Fecha', width: 'auto' },
          { header: 'Descripción', width: '*' },
          { header: 'Monto', align: 'right', width: 'auto' },
        ],
        rows: data.expenses.map((e) => [
          formatDate(e.date),
          e.description,
          money(e.amount),
        ]),
        emptyText: 'Sin gastos adelantados',
      },
    },
    { type: 'heading', text: 'Ajustes' },
    {
      type: 'table',
      table: {
        columns: [
          { header: 'Concepto', width: 'auto' },
          { header: 'Descripción', width: '*' },
          { header: 'Monto', align: 'right', width: 'auto' },
        ],
        rows: data.adjustments.map((a) => [
          label(ADJUSTMENT_LABEL, a.concept),
          a.description,
          money(a.amount),
        ]),
        emptyText: 'Sin ajustes',
      },
    },
    {
      type: 'keyValues',
      rows: [
        {
          label: 'Neto a transferir',
          value: money(data.netAmount),
          emphasis: true,
        },
      ],
    },
    { type: 'heading', text: 'Transferencias registradas' },
    {
      type: 'table',
      table: {
        columns: [
          { header: 'Fecha', width: 'auto' },
          { header: 'Medio', width: '*' },
          { header: 'Monto', align: 'right', width: 'auto' },
        ],
        rows: data.transfers.map((t) => [
          formatDate(t.date),
          label(METHOD_LABEL, t.method),
          money(t.amount),
        ]),
        totalRows:
          data.transfers.length > 0
            ? [['Total transferido', '', money(data.transferredTotal)]]
            : undefined,
        emptyText: 'Sin transferencias registradas',
      },
    },
  ]
  return buildDocument(
    branding,
    `Liquidación ${data.sequence} - ${formatPeriod(data.period)}`,
    blocks,
    { generatedOn },
  )
}
