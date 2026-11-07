import {
  arrearsTable,
  formatAmountEs,
  incomeTable,
  paymentsTable,
  ReportBranding,
  tablePdf,
} from './report-tables'

const meta = {
  generatedAt: '2026-11-02T12:00:00.000Z',
  filters: { from: '2026-06', to: '2026-11', ownerId: null },
}

const branding: ReportBranding = {
  brandName: 'Oppido SRL',
  primaryColor: '#c2410c',
  detailLines: ['CUIT 30-1'],
  footerLines: ['Pie fiscal'],
}

describe('formatAmountEs', () => {
  it('agrupa miles con punto y decimales con coma, sin perder centavos', () => {
    expect(formatAmountEs('1234567.5')).toBe('1.234.567,50')
    expect(formatAmountEs('-1500')).toBe('-1.500,00')
    expect(formatAmountEs('9999999999.99')).toBe('9.999.999.999,99')
  })
})

const zeroBreakdown = {
  rent: '0.00',
  lateFees: '0.00',
  charges: '0.00',
  total: '0.00',
}
const byReceiver = (agencyRent: string, ownerRent: string) => ({
  agency: { ...zeroBreakdown, rent: agencyRent, total: agencyRent },
  owner: { ...zeroBreakdown, rent: ownerRent, total: ownerRent },
})

describe('tablas de exportación', () => {
  it('la de ingresos suma los totales por moneda y deja los filtros en el encabezado', () => {
    const table = incomeTable(
      {
        ...meta,
        rows: [
          {
            period: '2026-10',
            currency: 'ARS',
            rentCollected: '100.50',
            lateFeesCollected: '0.00',
            chargesCollected: '0.00',
            collectedByReceiver: byReceiver('100.50', '0.00'),
            feesAccrued: '5.00',
            feesCollected: '5.00',
            netSettled: '95.50',
            netTransferred: '0.00',
          },
          {
            period: '2026-11',
            currency: 'ARS',
            rentCollected: '0.50',
            lateFeesCollected: '0.00',
            chargesCollected: '0.00',
            collectedByReceiver: byReceiver('0.00', '0.50'),
            feesAccrued: '0.00',
            feesCollected: '0.00',
            netSettled: '0.00',
            netTransferred: '95.50',
          },
        ],
        totals: [],
      },
      '2026-11-02',
    )
    expect(table.meta).toEqual([
      ['Generado', '2026-11-02'],
      ['Desde', '2026-06'],
      ['Hasta', '2026-11'],
    ])
    expect(table.columns).toHaveLength(11)
    expect(table.rows[0].slice(0, 3)).toEqual(['2026-10', 'ARS', '100.50'])
    expect(table.totalRows).toEqual([
      [
        'Total',
        'ARS',
        '101.00',
        '0.00',
        '0.00',
        '5.00',
        '5.00',
        '95.50',
        '95.50',
        '100.50',
        '0.50',
      ],
    ])
  })

  it('la de pagos traduce el medio y quién recibió, y totaliza por moneda', () => {
    const table = paymentsTable(
      [
        {
          paymentId: 'p',
          paidAt: '2026-10-05',
          period: '2026-10',
          renterName: 'Iván',
          propertyAddress: 'Calle 1',
          ownerName: 'Ana',
          amount: '100.00',
          currency: 'ARS',
          method: 'TRANSFER',
          receivedBy: 'AGENCY',
        },
      ],
      meta,
      '2026-11-02',
    )
    expect(table.rows[0].slice(-2)).toEqual(['Transferencia', 'Inmobiliaria'])
    expect(table.totalRows).toEqual([
      ['Total', '', '', '', '', '100.00', 'ARS', '', ''],
    ])
  })

  it('la de mora separa pesos y dólares en columnas numéricas', () => {
    const table = arrearsTable(
      {
        ...meta,
        rows: [
          {
            renterId: 'r',
            renterName: 'Iván',
            renterPhone: null,
            propertyAddress: 'Calle 1',
            ownerName: 'Ana',
            overdueInstallments: 2,
            maxDaysOverdue: 40,
            balance: [{ currency: 'USD', amount: '50.00' }],
            lateFee: [],
          },
        ],
        totals: [{ currency: 'USD', amount: '50.00' }],
      },
      '2026-11-02',
    )
    expect(table.rows[0]).toEqual([
      'Iván',
      null,
      'Calle 1',
      'Ana',
      '2',
      '40',
      '0.00',
      '50.00',
      '0.00',
      '0.00',
    ])
    expect(table.totalRows?.[0].slice(6, 8)).toEqual(['0.00', '50.00'])
  })
})

describe('tablePdf', () => {
  it('arma una hoja apaisada con la marca, los filtros, los montos formateados y los totales', () => {
    const table = paymentsTable(
      [
        {
          paymentId: 'p',
          paidAt: '2026-10-05',
          period: '2026-10',
          renterName: 'Iván',
          propertyAddress: 'Calle 1',
          ownerName: 'Ana',
          amount: '1234567.50',
          currency: 'ARS',
          method: 'CASH',
          receivedBy: 'OWNER',
        },
      ],
      meta,
      '2026-11-02',
    )
    const pdf = tablePdf(table, branding, '2026-11-02')
    expect(pdf.landscape).toBe(true)
    expect(pdf.header).toMatchObject({
      brandName: 'Oppido SRL',
      primaryColor: '#c2410c',
    })
    expect(pdf.footerLines).toEqual([
      'Pie fiscal',
      'Reporte generado el 2026-11-02',
    ])
    const block = pdf.blocks.find((b) => b.type === 'table')
    expect(block && block.type === 'table' && block.table.rows[0][5]).toBe(
      '1.234.567,50',
    )
    expect(
      block && block.type === 'table' && block.table.columns[5].align,
    ).toBe('right')
  })
})
