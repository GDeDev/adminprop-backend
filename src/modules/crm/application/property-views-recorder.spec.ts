import { RequestContext } from '@/shared/context/request-context'
import { PropertyViewsRecorder } from './property-views-recorder'

describe('PropertyViewsRecorder', () => {
  let repo: { increment: jest.Mock }
  let recorder: PropertyViewsRecorder
  const T0 = new Date('2026-11-05T10:00:00Z')

  const record = (
    ip: string | null,
    userAgent: string | null,
    at = T0,
    propertyId = 'p1',
  ) =>
    RequestContext.runInTenant('t1', () =>
      recorder.record(propertyId, { ip, userAgent }, at),
    )

  beforeEach(() => {
    repo = { increment: jest.fn().mockResolvedValue(undefined) }
    recorder = new PropertyViewsRecorder(repo as never)
  })

  it('cuenta una vista y suma al día de hoy', async () => {
    await expect(record('1.1.1.1', 'Mozilla/5.0')).resolves.toBe(true)
    expect(repo.increment).toHaveBeenCalledWith('p1', '2026-11-05')
  })

  it('ignora a los bots conocidos', async () => {
    await expect(record('1.1.1.1', 'Googlebot/2.1')).resolves.toBe(false)
    expect(repo.increment).not.toHaveBeenCalled()
  })

  it('no cuenta dos veces la misma IP y propiedad en 30 minutos', async () => {
    await record('1.1.1.1', 'Mozilla/5.0')
    const soon = new Date(T0.getTime() + 10 * 60_000)
    await expect(record('1.1.1.1', 'Mozilla/5.0', soon)).resolves.toBe(false)
    expect(repo.increment).toHaveBeenCalledTimes(1)
  })

  it('vuelve a contar pasada la ventana, con otra IP o con otra propiedad', async () => {
    await record('1.1.1.1', 'Mozilla/5.0')
    const later = new Date(T0.getTime() + 31 * 60_000)
    await expect(record('1.1.1.1', 'Mozilla/5.0', later)).resolves.toBe(true)
    await expect(record('2.2.2.2', 'Mozilla/5.0')).resolves.toBe(true)
    await expect(record('1.1.1.1', 'Mozilla/5.0', T0, 'p2')).resolves.toBe(true)
  })
})
