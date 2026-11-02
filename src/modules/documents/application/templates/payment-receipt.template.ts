import { PdfBlock, PdfDocumentDefinition } from '@/platform/pdf/pdf.port'
import { IsoDate } from '@/shared/dates/calendar-date'
import { PaymentReceiptDocumentData } from '../../domain/document'
import {
  EXCHANGE_SOURCE_LABEL,
  METHOD_LABEL,
  RECEIVER_LABEL,
  formatAmount,
  formatDate,
  formatMoney,
  formatPeriod,
  label,
} from './format'
import { buildDocument, DocumentBranding } from './layout'

export const VOID_WATERMARK = 'ANULADO'

/** PDF-03: el recibo de un pago; anulado, lleva marca de agua. */
export function paymentReceiptTemplate(
  data: PaymentReceiptDocumentData,
  branding: DocumentBranding,
  generatedOn: IsoDate,
): PdfDocumentDefinition {
  const cc = data.contractCurrency
  const blocks: PdfBlock[] = [
    {
      type: 'title',
      text: `Recibo ${data.receiptNumber}`,
      subtitle: `Fecha de pago: ${formatDate(data.paidAt)}`,
    },
    ...(data.voided
      ? [
          {
            type: 'paragraph' as const,
            text: `Recibo anulado${data.voidedAt ? ` el ${formatDate(data.voidedAt)}` : ''}${data.voidReason ? `: ${data.voidReason}` : ''}.`,
          },
        ]
      : []),
    {
      type: 'keyValues',
      rows: [
        {
          label: 'Recibimos de',
          value: data.renter
            ? `${data.renter.name}${data.renter.nationalId ? ` (${data.renter.nationalId})` : ''}`
            : '-',
        },
        { label: 'Propiedad', value: data.property ?? '-' },
        { label: 'Cuota', value: formatPeriod(data.installmentPeriod) },
        {
          label: 'Importe recibido',
          value: formatMoney(data.amount, data.paidCurrency),
          emphasis: true,
        },
        ...(data.exchange
          ? [
              {
                label: 'Cotización',
                value: `${formatAmount(data.exchange.rate)} (${label(EXCHANGE_SOURCE_LABEL, data.exchange.source)}, ${formatDate(data.exchange.date)})`,
              },
              {
                label: 'Equivalente en la moneda de la cuota',
                value: formatMoney(data.exchange.equivalent, cc),
              },
            ]
          : []),
        { label: 'Medio de pago', value: label(METHOD_LABEL, data.method) },
        { label: 'Recibió', value: label(RECEIVER_LABEL, data.receivedBy) },
      ],
    },
    { type: 'heading', text: 'Imputación' },
    {
      type: 'table',
      table: {
        columns: [
          { header: 'Concepto', width: '*' },
          { header: 'Monto', align: 'right', width: 'auto' },
        ],
        rows: [
          ['Punitorio', formatMoney(data.allocation.lateFee, cc)],
          ['Alquiler', formatMoney(data.allocation.rent, cc)],
          ['Cargos', formatMoney(data.allocation.charges, cc)],
          [
            'Saldo a favor generado',
            formatMoney(data.allocation.creditGenerated, cc),
          ],
        ],
      },
    },
    {
      type: 'keyValues',
      rows: [
        {
          label: 'Saldo restante de la cuota',
          value: formatMoney(data.remaining.total, cc),
          emphasis: true,
        },
      ],
    },
    ...(data.notes
      ? [{ type: 'paragraph' as const, text: `Notas: ${data.notes}` }]
      : []),
    { type: 'spacer' },
    {
      type: 'paragraph',
      text: data.registeredBy
        ? `Registrado por ${data.registeredBy}.`
        : 'Recibo emitido por la inmobiliaria.',
    },
    {
      type: 'paragraph',
      muted: true,
      text: `${branding.brandName}. El presente recibo acredita el pago indicado y se emite sin perjuicio de las sumas que correspondan por otros conceptos.`,
    },
  ]
  return buildDocument(branding, `Recibo ${data.receiptNumber}`, blocks, {
    generatedOn,
    watermark: data.voided ? VOID_WATERMARK : undefined,
  })
}
