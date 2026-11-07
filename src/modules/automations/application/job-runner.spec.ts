import {
  JobExecution,
  JobExecutionRepository,
} from '../domain/automations.ports'
import { JobExecutionStatus, JobName, JobTrigger } from '../domain/job-catalog'
import { JOB_RETRY_LIMIT } from './automation-queues'
import { JobRegistry } from './job-registry'
import { JobRunner } from './job-runner'
import { AutomationJob, JobMessage } from './job.types'

const execution = (overrides: Partial<JobExecution> = {}): JobExecution => ({
  id: 'exec-1',
  job: JobName.CONTRACTS_FINISH_EXPIRED,
  tenantId: 'tenant-1',
  scheduledFor: '2026-10-31',
  startedAt: new Date(),
  finishedAt: null,
  status: JobExecutionStatus.RUNNING,
  affected: 0,
  summary: null,
  error: null,
  details: null,
  triggeredBy: JobTrigger.SCHEDULE,
  triggeredByUserId: null,
  ...overrides,
})

const message = (job: JobName): JobMessage => ({
  job,
  executionId: 'exec-1',
  scheduledFor: '2026-10-31',
  period: null,
  manual: false,
})

function build(run: AutomationJob['run']) {
  const finish = jest.fn(async (_id: string, result) =>
    execution({ ...result, status: result.status }),
  )
  const executions = {
    findById: jest.fn(async () => execution()),
    markRunning: jest.fn(async () => execution()),
    create: jest.fn(),
    finish,
  } as unknown as JobExecutionRepository
  const notifications = { notifyStaff: jest.fn(async () => 'SENT') }
  const registry = {
    get: () => ({ name: JobName.CONTRACTS_FINISH_EXPIRED, run }),
  } as unknown as JobRegistry
  const runner = new JobRunner(registry, executions, notifications as never)
  return { runner, finish, notifications, executions }
}

describe('JobRunner', () => {
  it('guarda el resultado del job en la ejecución', async () => {
    const { runner, finish } = build(async () => ({
      affected: 3,
      summary: '3 contratos finalizados',
    }))

    await runner.execute(message(JobName.CONTRACTS_FINISH_EXPIRED), 'tenant-1')

    expect(finish).toHaveBeenCalledWith('exec-1', {
      status: JobExecutionStatus.SUCCEEDED,
      affected: 3,
      summary: '3 contratos finalizados',
      error: null,
      details: null,
    })
  })

  it('respeta el estado que devuelve el job (SKIPPED, PARTIAL)', async () => {
    const { runner, finish } = build(async () => ({
      status: JobExecutionStatus.SKIPPED,
      affected: 0,
      summary: 'Hoy no es el día',
    }))

    await runner.execute(message(JobName.CONTRACTS_FINISH_EXPIRED), 'tenant-1')

    expect(finish.mock.calls[0][1].status).toBe(JobExecutionStatus.SKIPPED)
  })

  it('un job que tira queda FAILED con el error y se vuelve a tirar para que la cola reintente', async () => {
    const { runner, finish, notifications } = build(async () => {
      throw new Error('se cayó la base')
    })

    await expect(
      runner.execute(message(JobName.CONTRACTS_FINISH_EXPIRED), 'tenant-1', 0),
    ).rejects.toThrow('se cayó la base')

    expect(finish).toHaveBeenCalledWith(
      'exec-1',
      expect.objectContaining({
        status: JobExecutionStatus.FAILED,
        error: 'se cayó la base',
      }),
    )
    // Todavía quedan reintentos: no se molesta al personal.
    expect(notifications.notifyStaff).not.toHaveBeenCalled()
  })

  it('agotados los reintentos avisa al personal (JOB_FAILED, una vez por job y día)', async () => {
    const { runner, notifications } = build(async () => {
      throw new Error('sigue caída')
    })

    await expect(
      runner.execute(
        message(JobName.CONTRACTS_FINISH_EXPIRED),
        'tenant-1',
        JOB_RETRY_LIMIT,
      ),
    ).rejects.toThrow('sigue caída')

    expect(notifications.notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        type: 'JOB_FAILED',
        dedupeKey: 'JOB_FAILED:contracts.finish-expired:2026-10-31',
      }),
    )
  })

  it('un job por inmobiliaria sin inmobiliaria es un error de quien lo encoló', async () => {
    const { runner } = build(async () => ({ affected: 0, summary: '' }))

    await expect(
      runner.execute(message(JobName.CONTRACTS_FINISH_EXPIRED), undefined),
    ).rejects.toThrow(/necesita una inmobiliaria/)
  })

  it('los jobs globales corren sin inmobiliaria aunque el mensaje traiga una', async () => {
    let seenTenant: string | null | undefined
    const { runner, finish } = build(async (context) => {
      seenTenant = context.tenantId
      return { affected: 0, summary: 'ok' }
    })

    await runner.execute(message(JobName.INDICES_FETCH), 'tenant-1')

    expect(seenTenant).toBeNull()
    expect(finish).toHaveBeenCalled()
  })
})
