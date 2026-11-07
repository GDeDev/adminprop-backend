import { RequestContext } from '@/shared/context/request-context'
import { JobName } from '../domain/job-catalog'
import { RunJobCommand } from './automation.commands'
import { RunJobHandler } from './automation.handlers'

function build(lastGlobalStartedAt: Date | null = null) {
  const scheduler = { enqueue: jest.fn().mockResolvedValue({ id: 'exec-1' }) }
  const executions = {
    findRecentRunning: jest.fn().mockResolvedValue(null),
    lastGlobal: jest
      .fn()
      .mockResolvedValue(
        lastGlobalStartedAt ? [{ startedAt: lastGlobalStartedAt }] : [],
      ),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const handler = new RunJobHandler(
    scheduler as never,
    executions as never,
    audit as never,
  )
  const run = (job: string) =>
    RequestContext.runInTenant('ten-1', () =>
      handler.execute(new RunJobCommand(job, undefined)),
    )
  return { run, scheduler }
}

// Antes cualquier ADMIN de cualquier inmobiliaria disparaba sin límite los jobs
// globales, incluido el que scrapea los portales para todas (D-254).
describe('RunJobHandler: jobs globales desde una inmobiliaria', () => {
  it('el de datos de mercado no se puede correr a mano', async () => {
    const { run, scheduler } = build()
    await expect(
      run(JobName.VALUATION_REFRESH_COMPARABLES),
    ).rejects.toMatchObject({ code: 'AUTOMATION_JOB_GLOBAL' })
    expect(scheduler.enqueue).not.toHaveBeenCalled()
  })

  it('el de índices se puede pedir, pero no dos veces en 30 minutos', async () => {
    const recent = build(new Date(Date.now() - 5 * 60_000))
    await expect(recent.run(JobName.INDICES_FETCH)).rejects.toMatchObject({
      code: 'AUTOMATION_JOB_COOLDOWN',
    })
    expect(recent.scheduler.enqueue).not.toHaveBeenCalled()

    const old = build(new Date(Date.now() - 31 * 60_000))
    await expect(old.run(JobName.INDICES_FETCH)).resolves.toEqual({
      executionId: 'exec-1',
    })
    expect(old.scheduler.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: JobName.INDICES_FETCH }),
      null,
      expect.anything(),
    )
  })

  it('los jobs por inmobiliaria siguen igual', async () => {
    const { run, scheduler } = build(new Date())
    await run(JobName.CONTRACTS_FINISH_EXPIRED)
    expect(scheduler.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      'ten-1',
      expect.anything(),
    )
  })
})
