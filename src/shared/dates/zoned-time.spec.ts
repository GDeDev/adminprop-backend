import { instantOf, localMoment } from './zoned-time'

describe('zoned-time', () => {
  it('Buenos Aires está 3 horas atrás de UTC, también cruzando el día', () => {
    expect(localMoment(new Date('2026-10-30T12:05:00Z'))).toEqual({
      date: '2026-10-30',
      time: '09:05',
    })
    // 01:30 UTC todavía es el día anterior para Argentina.
    expect(localMoment(new Date('2026-11-01T01:30:00Z'))).toEqual({
      date: '2026-10-31',
      time: '22:30',
    })
  })

  it('medianoche local es 00:00 y no 24:00', () => {
    expect(localMoment(new Date('2026-10-30T03:00:00Z'))).toEqual({
      date: '2026-10-30',
      time: '00:00',
    })
  })

  it('instantOf es la inversa de localMoment', () => {
    const instant = instantOf('2026-10-31', '09:10')
    expect(instant.toISOString()).toBe('2026-10-31T12:10:00.000Z')
    expect(localMoment(instant)).toEqual({ date: '2026-10-31', time: '09:10' })
  })
})
