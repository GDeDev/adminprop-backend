import {
  addDays,
  addMonths,
  daysBetween,
  firstDayOfPeriod,
  fullMonthsBetween,
  isValidIsoDate,
  isValidPeriod,
  lastDayOfPeriod,
  nextPeriod,
  previousPeriod,
  localDateOf,
  periodOf,
  todayIso,
  toIsoDate,
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

  it('valida períodos AAAA-MM: el mes tiene que existir', () => {
    expect(isValidPeriod('2026-10')).toBe(true)
    expect(isValidPeriod('2026-13')).toBe(false)
    expect(isValidPeriod('2026-00')).toBe(false)
    expect(isValidPeriod('2026-1')).toBe(false)
    expect(isValidPeriod('2026-10-01')).toBe(false)
  })

  it('da el primer y el último día de un período, y el siguiente', () => {
    expect(firstDayOfPeriod('2026-10')).toBe('2026-10-01')
    expect(lastDayOfPeriod('2026-10')).toBe('2026-10-31')
    expect(lastDayOfPeriod('2026-02')).toBe('2026-02-28')
    expect(lastDayOfPeriod('2024-02')).toBe('2024-02-29')
    expect(nextPeriod('2026-12')).toBe('2027-01')
    expect(nextPeriod('2026-01')).toBe('2026-02')
    expect(previousPeriod('2027-01')).toBe('2026-12')
    expect(previousPeriod('2026-03')).toBe('2026-02')
  })
})

describe('fecha de negocio (Argentina)', () => {
  // 01:00 UTC del 4 son las 22:00 del día 3 en Argentina: la ventana en la
  // que todayIso() devolvía la fecha UTC (mañana) y el sistema iba un día
  // adelantado.
  const lateEvening = new Date('2026-11-04T01:00:00Z')

  it('todayIso devuelve el día argentino y no el UTC', () => {
    expect(todayIso(lateEvening)).toBe('2026-11-03')
    expect(toIsoDate(lateEvening)).toBe('2026-11-04')
  })

  it('cambia de día a las 03:00 UTC, no a las 00:00', () => {
    expect(todayIso(new Date('2026-11-04T02:59:59Z'))).toBe('2026-11-03')
    expect(todayIso(new Date('2026-11-04T03:00:00Z'))).toBe('2026-11-04')
  })

  it('localDateOf ubica un instante en el calendario de negocio', () => {
    expect(localDateOf(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31')
    expect(localDateOf(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31')
  })
})
