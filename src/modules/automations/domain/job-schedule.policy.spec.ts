import {
  JOB_CATALOG,
  JobName,
  cronLabelOf,
  cronOf,
  findJobDefinition,
} from './job-catalog'
import { JobSchedulePolicy } from './job-schedule.policy'

const job = (name: JobName) => findJobDefinition(name)!

describe('JobSchedulePolicy', () => {
  it('antes de la hora no hay nada que encolar', () => {
    expect(
      JobSchedulePolicy.missingRuns(
        job(JobName.ARREARS_NOTICE),
        { date: '2026-10-31', time: '09:00' },
        0,
      ),
    ).toBe(0)
  })

  it('a la hora o después, falta la corrida de hoy hasta que se encola', () => {
    const now = { date: '2026-10-31', time: '09:10' }
    expect(
      JobSchedulePolicy.missingRuns(job(JobName.ARREARS_NOTICE), now, 0),
    ).toBe(1)
    expect(
      JobSchedulePolicy.missingRuns(job(JobName.ARREARS_NOTICE), now, 1),
    ).toBe(0)
  })

  it('un servidor que estuvo caído recupera la corrida apenas vuelve', () => {
    // El job de las 09:10 y ya son las 15:40.
    expect(
      JobSchedulePolicy.missingRuns(
        job(JobName.ARREARS_NOTICE),
        { date: '2026-10-31', time: '15:40' },
        0,
      ),
    ).toBe(1)
  })

  it('los índices tienen dos corridas por día', () => {
    const fetch = job(JobName.INDICES_FETCH)
    expect(
      JobSchedulePolicy.missingRuns(
        fetch,
        { date: '2026-10-31', time: '06:00' },
        0,
      ),
    ).toBe(1)
    expect(
      JobSchedulePolicy.missingRuns(
        fetch,
        { date: '2026-10-31', time: '12:10' },
        1,
      ),
    ).toBe(1)
    expect(
      JobSchedulePolicy.missingRuns(
        fetch,
        { date: '2026-10-31', time: '23:50' },
        2,
      ),
    ).toBe(0)
  })

  it('la próxima corrida es hoy si queda alguna, si no mañana', () => {
    const arrears = job(JobName.ARREARS_NOTICE)
    const morning = new Date('2026-10-31T10:00:00Z') // 07:00 local
    expect(
      JobSchedulePolicy.nextRunAt(
        arrears,
        { date: '2026-10-31', time: '07:00' },
        morning,
      ).toISOString(),
    ).toBe('2026-10-31T12:10:00.000Z')

    const night = new Date('2026-10-31T23:00:00Z') // 20:00 local
    expect(
      JobSchedulePolicy.nextRunAt(
        arrears,
        { date: '2026-10-31', time: '20:00' },
        night,
      ).toISOString(),
    ).toBe('2026-11-01T12:10:00.000Z')
  })
})

describe('catálogo', () => {
  it('describe el cron y lo dice en castellano', () => {
    expect(cronOf(['09:10'])).toBe('10 9 * * *')
    expect(cronOf(['06:00', '12:00'])).toBe('0 6,12 * * *')
    expect(cronLabelOf(['00:10'])).toBe('todos los días a las 00:10')
    expect(cronLabelOf(['06:00', '12:00'])).toBe(
      'todos los días a las 06:00 y 12:00',
    )
  })

  it('cada job tiene nombre único y horas ordenadas', () => {
    const names = JOB_CATALOG.map((j) => j.name)
    expect(new Set(names).size).toBe(names.length)
    for (const j of JOB_CATALOG) {
      expect([...j.times].sort()).toEqual(j.times)
    }
  })
})
