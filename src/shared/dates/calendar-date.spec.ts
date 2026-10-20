import {
  addDays,
  addMonths,
  daysBetween,
  fullMonthsBetween,
  isValidIsoDate,
  periodOf,
} from './calendar-date'

describe('calendar-date', () => {
  it('valida fechas del calendario, no sólo el formato', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true)
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2026-02-29')).toBe(false)
    expect(isValidIsoDate('2026-13-01')).toBe(false)
    expect(isValidIsoDate('2026-3-1')).toBe(false)
  })

  it('suma días cruzando el mes y el año', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('suma meses conservando el día y recortando al fin de mes', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28')
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15')
  })

  it('cuenta días entre fechas, con signo', () => {
    expect(daysBetween('2026-12-01', '2026-12-31')).toBe(30)
    expect(daysBetween('2026-12-31', '2026-12-01')).toBe(-30)
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0)
  })

  it('cuenta meses enteros: del 31 al 30 del mes siguiente no es un mes', () => {
    expect(fullMonthsBetween('2026-01-01', '2027-12-31')).toBe(23)
    expect(fullMonthsBetween('2026-01-01', '2028-01-01')).toBe(24)
    expect(fullMonthsBetween('2026-01-31', '2026-02-28')).toBe(1)
    expect(fullMonthsBetween('2026-01-31', '2026-02-27')).toBe(0)
    expect(fullMonthsBetween('2026-03-01', '2026-01-01')).toBe(0)
  })

  it('el período de un índice es el mes de la fecha', () => {
    expect(periodOf('2026-03-15')).toBe('2026-03')
  })
})
