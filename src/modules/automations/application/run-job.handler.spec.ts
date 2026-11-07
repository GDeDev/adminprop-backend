import { RequestContext } from '@/shared/context/request-context'
import { JobName } from '../domain/job-catalog'
import { RunJobCommand } from './automation.commands'
import { RunJobHandler } from './automation.handlers'

function build(claims = true) {
  const scheduler = { enqueue: jest.fn().mockResolvedValue({ id: 'exec-1' }) }
  const executions = {
    findRecentRunning: jest.fn().mockResolvedValue(null),
  }
  const cooldowns = { claimGlobalOnce: jest.fn().mockResolvedValue(claims) }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const handler = new RunJobHandler(
    scheduler as never,
    executions as never,
    audit as never,
    cooldowns as never,
  )
  const run = (job: string) =>
    RequestContext.runInTenant('ten-1', () =>
      handler.execute(new RunJobCommand(job, undefined)),
    )
  return { run, scheduler, cooldowns }
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

  it('el de índices se puede pedir, pero no dos veces en 30 minutos (reclamo atómico)', async () => {
    const busy = build(false)
    await expect(busy.run(JobName.INDICES_FETCH)).rejects.toMatchObject({
      code: 'AUTOMATION_JOB_COOLDOWN',
    })
    expect(busy.scheduler.enqueue).not.toHaveBeenCalled()

    const free = build(true)
    await expect(free.run(JobName.INDICES_FETCH)).resolves.toEqual({
      executionId: 'exec-1',
    })
    expect(free.cooldowns.claimGlobalOnce).toHaveBeenCalledWith(
      'automations.global-manual-run',
      JobName.INDICES_FETCH,
      30 * 60_000,
    )
    expect(free.scheduler.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: JobName.INDICES_FETCH }),
      null,
      expect.anything(),
    )
  })

  it('los jobs por inmobiliaria siguen igual', async () => {
    const { run, scheduler, cooldowns } = build(false)
    await run(JobName.CONTRACTS_FINISH_EXPIRED)
    expect(cooldowns.claimGlobalOnce).not.toHaveBeenCalled()
    expect(scheduler.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      'ten-1',
      expect.anything(),
    )
  })
})
