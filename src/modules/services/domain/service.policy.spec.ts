import { IncreaseFrequency, ServiceStatus } from './property-service'
import {
  InvalidServiceDateException,
  ServiceDueDateRequiredException,
  ServiceIncreaseFrequencyRequiredException,
} from './service.exceptions'
import { ServicePolicy } from './service.policy'

const TODAY = '2026-10-20'

describe('ServicePolicy', () => {
  describe('vencimiento y aumentos (spec 6)', () => {
    it('con vencimiento exige la fecha', () => {
      expect(() =>
        ServicePolicy.normalizeSchedule({
          hasDueDate: true,
          dueDate: null,
          hasIncrease: false,
          increaseFrequency: null,
        }),
      ).toThrow(ServiceDueDateRequiredException)
      expect(() =>
        ServicePolicy.normalizeSchedule({
          hasDueDate: true,
          dueDate: '',
          hasIncrease: false,
          increaseFrequency: null,
        }),
      ).toThrow(ServiceDueDateRequiredException)
    })

    it('con aumentos exige la frecuencia', () => {
      expect(() =>
        ServicePolicy.normalizeSchedule({
          hasDueDate: false,
          dueDate: null,
          hasIncrease: true,
          increaseFrequency: null,
        }),
      ).toThrow(ServiceIncreaseFrequencyRequiredException)
    })

    it('sin vencimiento descarta la fecha y sin aumentos la frecuencia', () => {
      expect(
        ServicePolicy.normalizeSchedule({
          hasDueDate: false,
          dueDate: '2026-01-10',
          hasIncrease: false,
          increaseFrequency: IncreaseFrequency.MONTHLY,
        }),
      ).toEqual({
        hasDueDate: false,
        dueDate: null,
        hasIncrease: false,
        increaseFrequency: null,
      })
    })

    it('conserva lo que aplica, con la fecha recortada', () => {
      expect(
        ServicePolicy.normalizeSchedule({
          hasDueDate: true,
          dueDate: ' 2026-11-10 ',
          hasIncrease: true,
          increaseFrequency: IncreaseFrequency.QUARTERLY,
        }),
      ).toEqual({
        hasDueDate: true,
        dueDate: '2026-11-10',
        hasIncrease: true,
        increaseFrequency: IncreaseFrequency.QUARTERLY,
      })
    })

    it('rechaza una fecha que no existe en el calendario', () => {
      expect(() =>
        ServicePolicy.normalizeSchedule({
          hasDueDate: true,
          dueDate: '2026-02-30',
          hasIncrease: false,
          increaseFrequency: null,
        }),
      ).toThrow(InvalidServiceDateException)
    })
  })

  describe('estado calculado (spec 4)', () => {
    it('vencido sólo cuando la fecha ya pasó: el día del vencimiento sigue al día', () => {
      expect(ServicePolicy.status(true, '2026-10-19', TODAY)).toBe(
        ServiceStatus.OVERDUE,
      )
      expect(ServicePolicy.status(true, TODAY, TODAY)).toBe(
        ServiceStatus.UP_TO_DATE,
      )
      expect(ServicePolicy.status(true, '2026-10-21', TODAY)).toBe(
        ServiceStatus.UP_TO_DATE,
      )
    })

    it('sin vencimiento nunca está vencido, aunque haya quedado una fecha', () => {
      expect(ServicePolicy.status(false, null, TODAY)).toBe(
        ServiceStatus.UP_TO_DATE,
      )
      expect(ServicePolicy.status(false, '2020-01-01', TODAY)).toBe(
        ServiceStatus.UP_TO_DATE,
      )
      expect(ServicePolicy.status(true, null, TODAY)).toBe(
        ServiceStatus.UP_TO_DATE,
      )
    })

    it('cuenta los días de atraso: venció ayer = 1; al día = 0', () => {
      expect(ServicePolicy.daysOverdue(true, '2026-10-19', TODAY)).toBe(1)
      expect(ServicePolicy.daysOverdue(true, '2026-10-15', TODAY)).toBe(5)
      expect(ServicePolicy.daysOverdue(true, TODAY, TODAY)).toBe(0)
      expect(ServicePolicy.daysOverdue(true, '2026-12-01', TODAY)).toBe(0)
      expect(ServicePolicy.daysOverdue(false, '2026-10-01', TODAY)).toBe(0)
    })
  })
})
