import { PdfBlock, PdfDocumentDefinition } from '@/platform/pdf/pdf.port'
import { IsoDate } from '@/shared/dates/calendar-date'
import { OwnerStatementDocumentData } from '../../domain/document'
import {
  SEND_MODE_LABEL,
  formatDate,
  formatMoney,
  formatPeriod,
  formatPeriods,
  label,
} from './format'
import { buildDocument, DocumentBranding } from './layout'

/** PDF-02 = PDF-04: el resumen mensual consolidado del propietario (A-32). */
export function ownerStatementTemplate(
  data: OwnerStatementDocumentData,
  branding: DocumentBranding,
  generatedOn: IsoDate,
): PdfDocumentDefinition {
  const blocks: PdfBlock[] = [
    {
      type: 'title',
      text: 'Resumen mensual del propietario',
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
        {
          label: 'Cierre',
          value: data.closedAt ? formatDate(data.closedAt) : 'Abierto',
        },
        { label: 'Envío', value: label(SEND_MODE_LABEL, data.sendMode) },
      ],
    },
    { type: 'heading', text: 'Liquidaciones del mes' },
    {
      type: 'table',
      table: {
        columns: [
          { header: 'Propiedad', width: '*' },
          { header: 'Cuotas', width: 'auto' },
          { header: 'Alquiler', align: 'right', width: 'auto' },
          { header: 'Punit.', align: 'right', width: 'auto' },
          { header: 'Cargos', align: 'right', width: 'auto' },
          { header: 'Honor.', align: 'right', width: 'auto' },
          { header: 'Gastos', align: 'right', width: 'auto' },
          { header: 'Retenc.', align: 'right', width: 'auto' },
          { header: 'Adelantos', align: 'right', width: 'auto' },
          { header: 'Otros aj.', align: 'right', width: 'auto' },
          { header: 'Neto', align: 'right', width: 'auto' },
          { header: 'Transf.', align: 'right', width: 'auto' },
        ],
        rows: data.rows.map((r) => [
          r.property ?? '-',
          formatPeriods(r.installmentPeriods),
          formatMoney(r.rent, r.currency),
          formatMoney(r.lateFee, r.currency),
          formatMoney(r.charges, r.currency),
          formatMoney(r.fee, r.currency),
          formatMoney(r.expenses, r.currency),
          formatMoney(r.withholdings, r.currency),
          formatMoney(r.advances, r.currency),
          formatMoney(r.otherAdjustments, r.currency),
          formatMoney(r.net, r.currency),
          formatMoney(r.transferred, r.currency),
        ]),
        totalRows: data.totals.map((t) => [
          `Total ${t.currency}`,
          '',
          formatMoney(t.rent, t.currency),
          formatMoney(t.lateFee, t.currency),
          formatMoney(t.charges, t.currency),
          formatMoney(t.fee, t.currency),
          formatMoney(t.expenses, t.currency),
          formatMoney(t.withholdings, t.currency),
          formatMoney(t.advances, t.currency),
          formatMoney(t.otherAdjustments, t.currency),
          formatMoney(t.net, t.currency),
          formatMoney(t.transferred, t.currency),
        ]),
        emptyText: 'Sin liquidaciones en el mes',
      },
    },
    {
      type: 'paragraph',
      muted: true,
      text: 'Los montos de cada moneda se totalizan por separado.',
    },
  ]
  return buildDocument(
    branding,
    `Resumen ${formatPeriod(data.period)}`,
    blocks,
    {
      generatedOn,
    },
  )
}
