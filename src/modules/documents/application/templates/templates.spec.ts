import {
  PdfBlock,
  PdfDocumentDefinition,
  PdfTable,
} from '@/platform/pdf/pdf.port'
import {
  OwnerStatementDocumentData,
  PaymentReceiptDocumentData,
  SettlementDocumentData,
  TerminationNoticeDocumentData,
} from '../../domain/document'
import { formatAmount, formatDate, formatMoney, formatPeriod } from './format'
import { DocumentBranding } from './layout'
import { ownerStatementTemplate } from './owner-statement.template'
import {
  paymentReceiptTemplate,
  VOID_WATERMARK,
} from './payment-receipt.template'
import { settlementTemplate } from './settlement.template'
import { terminationNoticeTemplate } from './termination-notice.template'

const branding: DocumentBranding = {
  brandName: 'Inmobiliaria Test SRL',
  primaryColor: '#c2410c',
  detailLines: ['CUIT 30-12345678-9'],
  footerLines: ['Inmobiliaria Test SRL - CUIT 30-12345678-9'],
}
const TODAY = '2026-11-01'

const tables = (definition: PdfDocumentDefinition): PdfTable[] =>
  definition.blocks.flatMap((b: PdfBlock) =>
    b.type === 'table' ? [b.table] : [],
  )
const texts = (definition: PdfDocumentDefinition): string[] =>
  definition.blocks.flatMap((b: PdfBlock) => {
    switch (b.type) {
      case 'title':
        return [b.text, ...(b.subtitle ? [b.subtitle] : [])]
      case 'heading':
      case 'paragraph':
        return [b.text]
      case 'keyValues':
        return b.rows.flatMap((r) => [r.label, r.value])
      case 'table':
        return [...b.table.rows.flat(), ...(b.table.totalRows ?? []).flat()]
      default:
        return []
    }
  })

const settlement: SettlementDocumentData = {
  period: '2026-10',
  sequence: 3,
  currency: 'ARS',
  owner: { name: 'Ana Gómez', nationalId: '20111222334' },
  property: 'Av. Siempreviva 742',
  renter: 'Juan Pérez',
  payments: [
    {
      installmentPeriod: '2026-10',
      paidAt: '2026-10-05',
      rent: '1000000.00',
      lateFee: '0.00',
      charges: '25000.50',
    },
  ],
  rentTotal: '1000000.00',
  lateFeeTotal: '0.00',
  ownerChargesTotal: '25000.50',
  serviceChargesTotal: '0.00',
  fee: {
    mode: 'DEDUCTED',
    percentage: '5.00',
    fixedAmount: null,
    base: '1000000.00',
    total: '50000.00',
    deducted: true,
    mixedTerms: false,
  },
  expenses: [
    { date: '2026-10-10', description: 'Plomero', amount: '15000.00' },
  ],
  adjustments: [
    { concept: 'WITHHOLDING', description: 'IIBB', amount: '-5000.00' },
  ],
  netAmount: '955000.50',
  transfers: [{ date: '2026-10-12', amount: '955000.50', method: 'TRANSFER' }],
  transferredTotal: '955000.50',
  confirmedAt: '2026-10-11',
}

describe('formatos', () => {
  it('formatea montos como string sin perder centavos', () => {
    expect(formatAmount('1234567.5')).toBe('1.234.567,50')
    expect(formatAmount('-1234.05')).toBe('-1.234,05')
    expect(formatMoney('10', 'USD')).toBe('US$ 10,00')
    expect(formatMoney('-10', 'ARS')).toBe('-$ 10,00')
  })

  it('formatea fechas y períodos en español', () => {
    expect(formatDate('2026-10-31')).toBe('31/10/2026')
    expect(formatPeriod('2026-10')).toBe('Octubre 2026')
  })
})

describe('plantilla de liquidación', () => {
  const definition = settlementTemplate(settlement, branding, TODAY)

  it('lleva título, partes, pagos, honorarios, gastos, ajustes, neto y transferencias', () => {
    const all = texts(definition)
    expect(all).toContain('Liquidación n.º 3')
    expect(all).toContain('Octubre 2026')
    expect(all).toContain('Ana Gómez (20111222334)')
    expect(all).toContain('Pagos incluidos')
    expect(all).toContain('Honorarios de administración')
    expect(all).toContain('Neto a transferir')
    expect(all).toContain('$ 955.000,50')
    expect(all).toContain('Plomero')
    expect(all).toContain('Retención')
  })

  it('la tabla de pagos suma los totales en la fila de total', () => {
    const [payments] = tables(definition)
    expect(payments.rows).toHaveLength(1)
    expect(payments.totalRows?.[0]).toEqual([
      'Total',
      '',
      '$ 1.000.000,00',
      '$ 0,00',
      '$ 25.000,50',
    ])
  })

  it('pie con los datos fiscales y la fecha de generación, sin marca de agua', () => {
    expect(definition.footerLines).toContain('Documento generado el 01/11/2026')
    expect(definition.footerLines[0]).toContain('CUIT')
    expect(definition.watermark).toBeUndefined()
  })

  it('sin gastos, ajustes ni transferencias muestra el texto vacío', () => {
    const empty = settlementTemplate(
      { ...settlement, expenses: [], adjustments: [], transfers: [] },
      branding,
      TODAY,
    )
    const emptyTexts = tables(empty).map((t) => t.emptyText)
    expect(emptyTexts).toEqual(
      expect.arrayContaining([
        'Sin gastos adelantados',
        'Sin ajustes',
        'Sin transferencias registradas',
      ]),
    )
  })
})

describe('plantilla del resumen del propietario', () => {
  const statement: OwnerStatementDocumentData = {
    period: '2026-10',
    owner: { name: 'Ana Gómez', nationalId: null },
    sendMode: 'BOTH',
    rows: [
      {
        property: 'Av. Siempreviva 742',
        settlementPeriod: '2026-10',
        installmentPeriods: ['2026-09', '2026-10'],
        rent: '1000.00',
        lateFee: '0.00',
        charges: '0.00',
        fee: '50.00',
        expenses: '0.00',
        adjustments: '0.00',
        net: '950.00',
        transferred: '950.00',
        currency: 'ARS',
      },
    ],
    totals: [
      {
        currency: 'ARS',
        rent: '1000.00',
        lateFee: '0.00',
        charges: '0.00',
        fee: '50.00',
        expenses: '0.00',
        adjustments: '0.00',
        net: '950.00',
        transferred: '950.00',
      },
    ],
    closedAt: '2026-11-01',
  }

  it('una fila por liquidación y un total por moneda', () => {
    const definition = ownerStatementTemplate(statement, branding, TODAY)
    const [table] = tables(definition)
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0][1]).toBe('Septiembre 2026, Octubre 2026')
    expect(table.totalRows).toHaveLength(1)
    expect(table.totalRows?.[0][0]).toBe('Total ARS')
    expect(texts(definition)).toContain('Resumen y comprobantes')
  })
})

describe('plantilla del recibo', () => {
  const receipt: PaymentReceiptDocumentData = {
    receiptNumber: 'R-00000042',
    voided: false,
    voidReason: null,
    voidedAt: null,
    paidAt: '2026-10-05',
    renter: { name: 'Juan Pérez', nationalId: '30111222' },
    property: 'Av. Siempreviva 742',
    installmentPeriod: '2026-10',
    paidCurrency: 'USD',
    amount: '1000.00',
    exchange: {
      rate: '1200.0000',
      source: 'MEP',
      date: '2026-10-05',
      equivalent: '1200000.00',
    },
    contractCurrency: 'ARS',
    method: 'TRANSFER',
    receivedBy: 'AGENCY',
    allocation: {
      lateFee: '0.00',
      rent: '1200000.00',
      charges: '0.00',
      creditGenerated: '0.00',
    },
    remaining: {
      total: '0.00',
      rent: '0.00',
      lateFee: '0.00',
      charges: '0.00',
    },
    registeredBy: 'Admin',
    notes: null,
  }

  it('lleva el número, la cotización y el equivalente', () => {
    const all = texts(paymentReceiptTemplate(receipt, branding, TODAY))
    expect(all).toContain('Recibo R-00000042')
    expect(all).toContain('US$ 1.000,00')
    expect(all).toContain('$ 1.200.000,00')
    expect(all.some((t) => t.startsWith('1.200,00 (MEP'))).toBe(true)
  })

  it('un pago en la moneda de la cuota no muestra cotización', () => {
    const all = texts(
      paymentReceiptTemplate(
        { ...receipt, paidCurrency: 'ARS', exchange: null },
        branding,
        TODAY,
      ),
    )
    expect(all).not.toContain('Cotización')
  })

  it('anulado lleva marca de agua y el motivo', () => {
    const definition = paymentReceiptTemplate(
      {
        ...receipt,
        voided: true,
        voidReason: 'Error de carga',
        voidedAt: '2026-10-06',
      },
      branding,
      TODAY,
    )
    expect(definition.watermark).toBe(VOID_WATERMARK)
    expect(texts(definition).join(' ')).toContain('Error de carga')
  })

  it('vigente no lleva marca de agua', () => {
    expect(
      paymentReceiptTemplate(receipt, branding, TODAY).watermark,
    ).toBeUndefined()
  })
})

describe('plantilla de la rescisión', () => {
  const notice: TerminationNoticeDocumentData = {
    property: 'Av. Siempreviva 742',
    owner: { name: 'Ana Gómez', nationalId: null },
    renter: { name: 'Juan Pérez', nationalId: null },
    currency: 'ARS',
    startDate: '2025-01-01',
    endDate: '2027-12-31',
    notifiedAt: '2026-10-15',
    terminatedAt: '2026-10-15',
    currentRent: '1000000.00',
    remainingMonths: 14,
    remainingDays: 16,
    totalDays: 442,
    futureRent: '14500000.00',
    penaltyPercent: '10.00',
    penalty: '1450000.00',
    deposit: '1000000.00',
    depositCurrency: 'ARS',
    depositReturnMode: 'FIXED',
  }

  it('muestra el cálculo y el depósito', () => {
    const definition = terminationNoticeTemplate(notice, branding, TODAY)
    const [table] = tables(definition)
    expect(table.rows.map((r) => r[0])).toEqual([
      'Alquiler vigente',
      'Tiempo restante',
      'Canon futuro',
      'Multa (10,00 %)',
    ])
    expect(table.rows[1][1]).toBe('14 meses y 16 días')
    expect(table.totalRows?.[0]).toEqual(['Multa a abonar', '$ 1.450.000,00'])
    expect(texts(definition)).toContain('Se devuelve el importe recibido')
  })
})
