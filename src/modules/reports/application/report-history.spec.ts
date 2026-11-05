import type {
  ReportInstallmentRef,
  ReportRentTotalRef,
} from '@/modules/billing/public'
import { buildHistory } from './report-builders'
import { buildHistoryFromTotals } from './report-history'

const periods = ['2026-09', '2026-10']

describe('buildHistoryFromTotals', () => {
  it('da el mismo historial que sumar las cuotas una por una', () => {
    const rows = [
      {
        period: '2026-09',
        currency: 'ARS',
        baseAmount: '100000.00',
        rentPaid: '100000.00',
      },
      {
        period: '2026-09',
        currency: 'ARS',
        baseAmount: '80000.00',
        rentPaid: '30000.00',
      },
      {
        period: '2026-09',
        currency: 'USD',
        baseAmount: '500.00',
        rentPaid: '0.00',
      },
      {
        period: '2026-10',
        currency: 'ARS',
        baseAmount: '50000.00',
        rentPaid: '0.00',
      },
    ] as ReportInstallmentRef[]
    const totals: ReportRentTotalRef[] = [
      {
        period: '2026-09',
        currency: 'ARS',
        baseAmount: '180000.00',
        rentPaid: '130000.00',
      },
      {
        period: '2026-09',
        currency: 'USD',
        baseAmount: '500.00',
        rentPaid: '0.00',
      },
      {
        period: '2026-10',
        currency: 'ARS',
        baseAmount: '50000.00',
        rentPaid: '0.00',
      },
    ] as ReportRentTotalRef[]

    expect(buildHistoryFromTotals(periods, totals)).toEqual(
      buildHistory(periods, rows),
    )
  })

  it('un mes sin cuotas aparece con importes vacíos y se omiten las monedas en cero', () => {
    expect(
      buildHistoryFromTotals(periods, [
        {
          period: '2026-10',
          currency: 'ARS',
          baseAmount: '10.00',
          rentPaid: '0.00',
        },
      ] as ReportRentTotalRef[]),
    ).toEqual([
      { period: '2026-09', accrued: [], collected: [] },
      {
        period: '2026-10',
        accrued: [{ currency: 'ARS', amount: '10.00' }],
        collected: [],
      },
    ])
  })
})
