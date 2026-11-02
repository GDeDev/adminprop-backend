import {
  daysVacant,
  lastPeriods,
  periodsBetween,
  resolveRange,
  sumByCurrency,
} from './report-calculations'
import { InvalidReportRangeException } from './reports.exceptions'

describe('sumByCurrency', () => {
  it('suma por moneda sin mezclar pesos con dólares', () => {
    expect(
      sumByCurrency([
        { currency: 'USD', amount: '10.50' },
        { currency: 'ARS', amount: '100000.10' },
        { currency: 'ARS', amount: '0.20' },
        { currency: 'USD', amount: '0.25' },
      ]),
    ).toEqual([
      { currency: 'ARS', amount: '100000.30' },
      { currency: 'USD', amount: '10.75' },
    ])
  })

  it('no pierde centavos con montos grandes y omite las monedas en cero', () => {
    expect(
      sumByCurrency([
        { currency: 'ARS', amount: '9999999999.99' },
        { currency: 'ARS', amount: '0.01' },
        { currency: 'USD', amount: '0.00' },
      ]),
    ).toEqual([{ currency: 'ARS', amount: '10000000000.00' }])
    expect(sumByCurrency([])).toEqual([])
  })
})

describe('períodos', () => {
  it('lista los últimos meses cruzando el año, el más viejo primero', () => {
    expect(lastPeriods('2026-02', 4)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })

  it('lista todos los meses de un rango inclusive', () => {
    expect(periodsBetween('2026-11', '2027-01')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ])
    expect(periodsBetween('2026-05', '2026-05')).toEqual(['2026-05'])
  })
})

describe('resolveRange', () => {
  it('sin rango toma los últimos 6 meses hasta el mes de hoy', () => {
    expect(resolveRange(undefined, undefined, '2026-11-02')).toEqual({
      fromPeriod: '2026-06',
      toPeriod: '2026-11',
      fromDate: '2026-06-01',
      toDate: '2026-11-30',
    })
  })

  it('un mes en "desde" es su primer día y en "hasta" su último', () => {
    expect(resolveRange('2026-02', '2026-02', '2026-11-02')).toMatchObject({
      fromDate: '2026-02-01',
      toDate: '2026-02-28',
    })
  })

  it('acepta días exactos', () => {
    expect(
      resolveRange('2026-03-15', '2026-04-10', '2026-11-02'),
    ).toMatchObject({
      fromPeriod: '2026-03',
      toPeriod: '2026-04',
      fromDate: '2026-03-15',
      toDate: '2026-04-10',
    })
  })

  it('rechaza formatos inválidos, rangos al revés y rangos de más de 3 años', () => {
    expect(() => resolveRange('ayer', undefined, '2026-11-02')).toThrow(
      InvalidReportRangeException,
    )
    expect(() => resolveRange('2026-10', '2026-03', '2026-11-02')).toThrow(
      /no puede ser posterior/,
    )
    expect(() => resolveRange('2020-01', '2026-03', '2026-11-02')).toThrow(
      /36 meses/,
    )
    expect(() => resolveRange('2026-02-30', undefined, '2026-11-02')).toThrow(
      InvalidReportRangeException,
    )
  })
})

describe('daysVacant', () => {
  it('cuenta desde el fin del último contrato', () => {
    expect(
      daysVacant(['2026-01-31', '2026-08-31'], '2025-01-01', '2026-11-02'),
    ).toBe(63)
  })

  it('si nunca tuvo contrato cuenta desde el alta, y nunca da negativo', () => {
    expect(daysVacant([], '2026-10-23', '2026-11-02')).toBe(10)
    expect(daysVacant([], '2026-12-01', '2026-11-02')).toBe(0)
  })
})
