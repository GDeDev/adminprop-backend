import { PdfBlock, PdfDocumentDefinition } from '@/platform/pdf/pdf.port'
import { IsoDate } from '@/shared/dates/calendar-date'
import { PartyData, TerminationNoticeDocumentData } from '../../domain/document'
import {
  DEPOSIT_RETURN_LABEL,
  formatDate,
  formatMoney,
  formatPercentage,
  label,
  plural,
} from './format'
import { buildDocument, DocumentBranding } from './layout'

function person(party: PartyData | null): string {
  return party
    ? `${party.name}${party.nationalId ? ` (${party.nationalId})` : ''}`
    : '-'
}

/** PDF-05: el cálculo de la rescisión anticipada (RN-09). */
export function terminationNoticeTemplate(
  data: TerminationNoticeDocumentData,
  branding: DocumentBranding,
  generatedOn: IsoDate,
): PdfDocumentDefinition {
  const money = (amount: string) => formatMoney(amount, data.currency)
  const blocks: PdfBlock[] = [
    {
      type: 'title',
      text: 'Cálculo de rescisión anticipada',
      subtitle: data.property ?? undefined,
    },
    {
      type: 'keyValues',
      rows: [
        { label: 'Propietario', value: person(data.owner) },
        { label: 'Inquilino', value: person(data.renter) },
        {
          label: 'Vigencia del contrato',
          value: `${formatDate(data.startDate)} al ${formatDate(data.endDate)}`,
        },
        { label: 'Fecha de notificación', value: formatDate(data.notifiedAt) },
        { label: 'Fecha de rescisión', value: formatDate(data.terminatedAt) },
      ],
    },
    { type: 'heading', text: 'Cálculo' },
    {
      type: 'table',
      table: {
        columns: [
          { header: 'Concepto', width: '*' },
          { header: 'Valor', align: 'right', width: 'auto' },
        ],
        rows: [
          ['Alquiler vigente', money(data.currentRent)],
          [
            'Tiempo restante',
            `${plural(data.remainingMonths, 'mes', 'meses')} y ${plural(data.remainingDays, 'día', 'días')}`,
          ],
          ['Canon futuro', money(data.futureRent)],
          [
            `Multa (${formatPercentage(data.penaltyPercent)})`,
            money(data.penalty),
          ],
        ],
        totalRows: [['Multa a abonar', money(data.penalty)]],
      },
    },
    { type: 'heading', text: 'Depósito en garantía' },
    {
      type: 'keyValues',
      rows: [
        {
          label: 'Depósito recibido',
          value: formatMoney(data.deposit, data.depositCurrency),
        },
        {
          label: 'Devolución',
          value: label(DEPOSIT_RETURN_LABEL, data.depositReturnMode),
        },
      ],
    },
    {
      type: 'paragraph',
      muted: true,
      text: 'Cálculo informativo. Las deducciones del depósito se justifican al cerrar las cuentas del contrato.',
    },
  ]
  return buildDocument(branding, 'Cálculo de rescisión', blocks, {
    generatedOn,
  })
}
