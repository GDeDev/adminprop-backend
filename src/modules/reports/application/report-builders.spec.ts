import type {
  OverdueInstallmentRef,
  ReportInstallmentRef,
  ReportPaymentRef,
} from '@/modules/billing/public'
import type { ContractReportRef } from '@/modules/contracts/public'
import type { PropertyReportRef } from '@/modules/properties/public'
import type { ReportSettlementRef } from '@/modules/settlements/public'
import {
  buildArrearsRows,
  buildHistory,
  buildIncomeRows,
  buildIncomeTotals,
  buildInstallmentBuckets,
  buildPaymentRows,
  buildPropertyRows,
  hasRenewal,
  totalsOf,
} from './report-builders'

const installment = (
  overrides: Record<string, unknown>,
): ReportInstallmentRef =>
  ({
    id: 'i',
    period: '2026-11',
    currency: 'ARS',
    baseAmount: '100000.00',
    status: 'PENDING',
    paidTotal: '0.00',
    rentPaid: '0.00',
    totalDue: '100000.00',
    lateFeeAccrued: '0.00',
    lateFeePaid: '0.00',
    feeOnCollected: '0.00',
    ...overrides,
  }) as ReportInstallmentRef

describe('buildInstallmentBuckets', () => {
  it('agrupa por estado y suma por moneda: lo cobrado en las saldadas, la deuda en las demás', () => {
    const buckets = buildInstallmentBuckets([
      installment({ status: 'PAID', paidTotal: '100000.00' }),
      installment({ status: 'PAID', paidTotal: '50.00', currency: 'USD' }),
      installment({ status: 'PARTIAL', totalDue: '40000.00' }),
      installment({ status: 'OVERDUE', totalDue: '130000.55' }),
      installment({ status: 'OVERDUE', totalDue: '0.45' }),
    ])
    expect(buckets.paid).toEqual({
      count: 2,
      amounts: [
        { currency: 'ARS', amount: '100000.00' },
        { currency: 'USD', amount: '50.00' },
      ],
    })
    expect(buckets.partial.amounts).toEqual([
      { currency: 'ARS', amount: '40000.00' },
    ])
    expect(buckets.overdue).toEqual({
      count: 2,
      amounts: [{ currency: 'ARS', amount: '130001.00' }],
    })
    expect(buckets.pending).toEqual({ count: 0, amounts: [] })
  })
})

describe('buildHistory', () => {
  it('devuelve un punto por mes pedido, también los vacíos, con devengado y cobrado', () => {
    const history = buildHistory(
      ['2026-09', '2026-10'],
      [
        installment({ period: '2026-10', rentPaid: '60000.00' }),
        installment({
          period: '2026-10',
          currency: 'USD',
          baseAmount: '300.00',
          rentPaid: '300.00',
        }),
      ],
    )
    expect(history[0]).toEqual({
      period: '2026-09',
      accrued: [],
      collected: [],
    })
    expect(history[1].accrued).toEqual([
      { currency: 'ARS', amount: '100000.00' },
      { currency: 'USD', amount: '300.00' },
    ])
    expect(history[1].collected).toEqual([
      { currency: 'ARS', amount: '60000.00' },
      { currency: 'USD', amount: '300.00' },
    ])
  })
})

describe('buildIncomeRows', () => {
  const payment = (overrides: Record<string, unknown>): ReportPaymentRef =>
    ({
      paymentId: 'p',
      paidAt: '2026-10-05',
      currency: 'ARS',
      rentApplied: '100000.00',
      lateFeeApplied: '0.00',
      chargesApplied: '0.00',
      ...overrides,
    }) as ReportPaymentRef

  const settlement = (
    overrides: Partial<ReportSettlementRef>,
  ): ReportSettlementRef => ({
    id: 's',
    ownerId: 'o',
    propertyId: 'pr',
    period: '2026-10',
    currency: 'ARS' as never,
    status: 'CONFIRMED' as never,
    netAmount: '95000.00',
    feeTotal: '5000.00',
    feeDeducted: true,
    transfers: [],
    ...overrides,
  })

  it('arma una fila por mes y moneda con lo cobrado por fecha de pago y lo liquidado por período', () => {
    const rows = buildIncomeRows(
      '2026-09',
      '2026-10',
      [
        payment({}),
        payment({ lateFeeApplied: '2500.00', chargesApplied: '300.00' }),
        payment({
          paidAt: '2026-09-30',
          currency: 'USD',
          rentApplied: '200.00',
        }),
        // Fuera del rango: se descarta.
        payment({ paidAt: '2026-12-01' }),
      ],
      [
        settlement({
          transfers: [
            { transferredAt: '2026-10-20', amount: '60000.00' },
            { transferredAt: '2026-11-02', amount: '35000.00' },
          ],
        }),
        settlement({ id: 's2', feeDeducted: false, netAmount: '100000.00' }),
      ],
      [{ paidAt: '2026-10-25', amount: '5000.00', currency: 'ARS' as never }],
    )

    expect(rows.map((r) => `${r.period}|${r.currency}`)).toEqual([
      '2026-09|USD',
      '2026-10|ARS',
    ])
    expect(rows[0]).toMatchObject({ rentCollected: '200.00' })
    expect(rows[1]).toEqual({
      period: '2026-10',
      currency: 'ARS',
      rentCollected: '200000.00',
      lateFeesCollected: '2500.00',
      chargesCollected: '300.00',
      collectedByReceiver: {
        agency: {
          rent: '200000.00',
          lateFees: '2500.00',
          charges: '300.00',
          total: '202800.00',
        },
        owner: {
          rent: '0.00',
          lateFees: '0.00',
          charges: '0.00',
          total: '0.00',
        },
      },
      feesAccrued: '10000.00',
      // 5000 descontados en la liquidación + 5000 que pagó el propietario.
      feesCollected: '10000.00',
      netSettled: '195000.00',
      netTransferred: '95000.00',
    })
  })

  it('separa lo cobrado por la inmobiliaria de lo percibido por el propietario, sin mezclar monedas (D-235)', () => {
    const rows = buildIncomeRows(
      '2026-10',
      '2026-10',
      [
        payment({ receivedBy: 'AGENCY' }),
        payment({
          receivedBy: 'OWNER',
          rentApplied: '80000.00',
          lateFeeApplied: '1000.00',
          chargesApplied: '500.50',
        }),
        payment({
          receivedBy: 'OWNER',
          currency: 'USD',
          rentApplied: '300.00',
        }),
      ],
      [],
      [],
    )
    const ars = rows.find((r) => r.currency === 'ARS')
    // Los campos de siempre siguen sumando todo lo confirmado.
    expect(ars).toMatchObject({
      rentCollected: '180000.00',
      lateFeesCollected: '1000.00',
      chargesCollected: '500.50',
    })
    expect(ars?.collectedByReceiver).toEqual({
      agency: {
        rent: '100000.00',
        lateFees: '0.00',
        charges: '0.00',
        total: '100000.00',
      },
      owner: {
        rent: '80000.00',
        lateFees: '1000.00',
        charges: '500.50',
        total: '81500.50',
      },
    })

    const totals = buildIncomeTotals(rows)
    expect(totals.map((t) => t.currency)).toEqual(['ARS', 'USD'])
    expect(totals[0].collected.total).toBe('181500.50')
    expect(totals[0].collectedByReceiver.agency.total).toBe('100000.00')
    expect(totals[0].collectedByReceiver.owner.total).toBe('81500.50')
    expect(totals[1].collected.total).toBe('300.00')
    expect(totals[1].collectedByReceiver.owner.rent).toBe('300.00')
    expect(totals[1].collectedByReceiver.agency.total).toBe('0.00')
  })

  it('un mes sin movimientos no genera fila', () => {
    expect(buildIncomeRows('2026-01', '2026-03', [], [], [])).toEqual([])
  })
})

describe('buildPaymentRows', () => {
  it('ordena del más reciente al más viejo y resuelve los nombres', () => {
    const rows = buildPaymentRows(
      [
        {
          paymentId: 'a',
          paidAt: '2026-10-01',
          period: '2026-10',
          renterId: 'r',
          propertyId: 'pr',
          ownerId: 'o',
          paidCurrency: 'USD',
          amount: '10.00',
          method: 'CASH',
          receivedBy: 'OWNER',
        } as unknown as ReportPaymentRef,
        {
          paymentId: 'b',
          paidAt: '2026-10-09',
          period: '2026-10',
          renterId: 'x',
          propertyId: 'pr',
          ownerId: 'o',
          paidCurrency: 'ARS',
          amount: '5.00',
          method: 'TRANSFER',
          receivedBy: 'AGENCY',
        } as unknown as ReportPaymentRef,
      ],
      {
        renters: new Map([['r', { fullName: 'Iván López' }]]),
        properties: new Map([['pr', { address: 'Calle 1 100' }]]),
        owners: new Map([['o', { fullName: 'Ana Gómez' }]]),
      },
    )
    expect(rows.map((r) => r.paymentId)).toEqual(['b', 'a'])
    expect(rows[0].renterName).toBe('-')
    expect(rows[1]).toMatchObject({
      renterName: 'Iván López',
      propertyAddress: 'Calle 1 100',
      ownerName: 'Ana Gómez',
      currency: 'USD',
      amount: '10.00',
    })
  })
})

describe('buildArrearsRows', () => {
  const overdue = (overrides: Record<string, unknown>): OverdueInstallmentRef =>
    ({
      id: 'i',
      renterId: 'r1',
      propertyId: 'p1',
      ownerId: 'o1',
      currency: 'ARS',
      daysOverdue: 10,
      totalDue: '100000.00',
      lateFeeBalance: '5000.00',
      ...overrides,
    }) as OverdueInstallmentRef
  const names = {
    renters: new Map([
      ['r1', { fullName: 'Iván López', phone: '2215550000' }],
      ['r2', { fullName: 'Ana Pérez', phone: null }],
    ]),
    properties: new Map([
      ['p1', { address: 'Calle 1 100' }],
      ['p2', { address: 'Calle 2 200' }],
    ]),
    owners: new Map([['o1', { fullName: 'Marta Díaz' }]]),
  }

  it('agrupa por inquilino y propiedad con saldo y punitorio por moneda, los más atrasados primero', () => {
    const rows = buildArrearsRows(
      [
        overdue({ id: 'a', daysOverdue: 40 }),
        overdue({
          id: 'b',
          daysOverdue: 10,
          totalDue: '50.25',
          lateFeeBalance: '0.00',
          currency: 'USD',
        }),
        overdue({
          id: 'c',
          renterId: 'r2',
          propertyId: 'p2',
          daysOverdue: 70,
          totalDue: '1000.00',
          lateFeeBalance: '0.00',
        }),
      ],
      1,
      names,
    )
    expect(rows.map((r) => r.renterName)).toEqual(['Ana Pérez', 'Iván López'])
    expect(rows[1]).toMatchObject({
      renterPhone: '2215550000',
      overdueInstallments: 2,
      maxDaysOverdue: 40,
      balance: [
        { currency: 'ARS', amount: '100000.00' },
        { currency: 'USD', amount: '50.25' },
      ],
      lateFee: [{ currency: 'ARS', amount: '5000.00' }],
    })
    expect(totalsOf(rows)).toEqual([
      { currency: 'ARS', amount: '101000.00' },
      { currency: 'USD', amount: '50.25' },
    ])
  })

  it('descarta las cuotas con menos días de atraso que el mínimo', () => {
    const rows = buildArrearsRows(
      [overdue({ daysOverdue: 3 }), overdue({ id: 'z', daysOverdue: 31 })],
      30,
      names,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].overdueInstallments).toBe(1)
  })
})

describe('buildPropertyRows', () => {
  const properties: PropertyReportRef[] = [
    {
      id: 'p1',
      address: 'A 1',
      status: 'RENTED' as never,
      ownerId: 'o',
      createdAt: '2025-01-01',
    },
    {
      id: 'p2',
      address: 'B 2',
      status: 'AVAILABLE' as never,
      ownerId: 'o',
      createdAt: '2026-10-23',
    },
    {
      id: 'p3',
      address: 'C 3',
      status: 'AVAILABLE' as never,
      ownerId: 'o',
      createdAt: '2020-01-01',
    },
    {
      id: 'p4',
      address: 'D 4',
      status: 'MAINTENANCE' as never,
      ownerId: 'o',
      createdAt: '2020-01-01',
    },
  ]
  const contract = (o: Record<string, unknown>): ContractReportRef =>
    ({
      id: 'c',
      propertyId: 'p1',
      renterId: 'r',
      status: 'ACTIVE',
      currency: 'USD',
      currentRent: '350',
      endDate: '2027-03-31',
      terminatedAt: null,
      renewedFromId: null,
      ...o,
    }) as ContractReportRef
  const contracts = [
    contract({}),
    contract({
      id: 'old',
      propertyId: 'p3',
      status: 'TERMINATED' as never,
      endDate: '2026-12-31',
      terminatedAt: '2026-09-02',
    }),
  ]
  const names = { renters: new Map([['r', { fullName: 'Iván López' }]]) }

  it('muestra al inquilino y el alquiler de las alquiladas y los días vacías de las disponibles', () => {
    const rows = buildPropertyRows(properties, contracts, names, '2026-11-02')
    expect(rows[0]).toMatchObject({
      status: 'RENTED',
      renterName: 'Iván López',
      rent: { currency: 'USD', amount: '350.00' },
      contractEndDate: '2027-03-31',
      daysVacant: null,
    })
    // Sin contrato: desde el alta.
    expect(rows[1]).toMatchObject({ status: 'AVAILABLE', daysVacant: 10 })
    // Rescindido: desde la rescisión, no desde el fin pactado.
    expect(rows[2]).toMatchObject({ status: 'AVAILABLE', daysVacant: 61 })
    expect(rows[3]).toMatchObject({ status: 'OTHER', daysVacant: null })
  })

  it('filtra por estado', () => {
    expect(
      buildPropertyRows(
        properties,
        contracts,
        names,
        '2026-11-02',
        'AVAILABLE',
      ),
    ).toHaveLength(2)
  })
})

describe('hasRenewal', () => {
  it('detecta la renovación en marcha pero ignora las rescindidas', () => {
    const base = { renewedFromId: null } as ContractReportRef
    expect(
      hasRenewal('a', [
        base,
        { ...base, status: 'ACTIVE', renewedFromId: 'a' } as ContractReportRef,
      ]),
    ).toBe(true)
    expect(
      hasRenewal('a', [
        {
          ...base,
          status: 'TERMINATED',
          renewedFromId: 'a',
        } as ContractReportRef,
      ]),
    ).toBe(false)
  })
})
