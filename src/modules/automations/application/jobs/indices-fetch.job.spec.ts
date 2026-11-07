import { IndexType } from '@/modules/indices/public'
import {
  IndexSourcePort,
  IndexSourceUnavailableError,
} from '@/platform/index-source/index-source.port'
import { RequestContext } from '@/shared/context/request-context'
import { IndexFetchStatus, JobExecutionStatus } from '../../domain/job-catalog'
import { IndicesFetchJob } from './indices-fetch.job'

const TODAY = '2026-10-31'
const MISSING = ['2026-07', '2026-08', '2026-09']

function build(
  source: Partial<IndexSourcePort>,
  { today = TODAY, missing = MISSING } = {},
) {
  const indices = {
    missingPeriods: jest.fn(async () => missing),
    registerFromSource: jest.fn(async () => true),
  }
  const tenants = {
    listActive: jest.fn(async () => [
      { id: 'tenant-a', name: 'A', slug: 'a' },
      { id: 'tenant-b', name: 'B', slug: 'b' },
    ]),
  }
  const contracts = {
    indexTypesInUse: jest.fn(async () =>
      RequestContext.tenantId === 'tenant-a' ? ['ICL' as const] : [],
    ),
  }
  const notifications = { notifyStaff: jest.fn(async () => 'SENT') }
  const job = new IndicesFetchJob(
    { provider: 'bcra-indec', supports: () => true, ...source } as never,
    indices as never,
    tenants as never,
    contracts as never,
    notifications as never,
  )
  const run = () =>
    RequestContext.run({ correlationId: 'test' }, () =>
      job.run({ tenantId: null, today, manual: false, period: null }),
    )
  return { run, indices, notifications }
}

describe('IndicesFetchJob', () => {
  it('con la fuente manual no busca nada y termina SKIPPED', async () => {
    const { run, indices } = build({ provider: 'manual' })

    const outcome = await run()

    expect(outcome.status).toBe(JobExecutionStatus.SKIPPED)
    expect(indices.missingPeriods).not.toHaveBeenCalled()
  })

  it('carga los meses que trajo la fuente y deja el resultado por tipo en details', async () => {
    const { run, indices, notifications } = build({
      fetch: async (_type, periods) => ({
        source: 'bcra',
        values: periods.map((period) => ({ period, value: '1.5' })),
      }),
    })

    const outcome = await run()

    expect(outcome.status).toBe(JobExecutionStatus.SUCCEEDED)
    expect(outcome.affected).toBe(6)
    expect(indices.registerFromSource).toHaveBeenCalledWith(
      IndexType.ICL,
      '2026-07',
      '1.5',
      'bcra',
    )
    expect(outcome.details).toMatchObject({
      ICL: { status: IndexFetchStatus.SUCCEEDED, fetched: MISSING },
      IPC: { status: IndexFetchStatus.SUCCEEDED },
    })
    expect(notifications.notifyStaff).not.toHaveBeenCalled()
  })

  it('un mes que la fuente no publicó deja la corrida PARTIAL y avisa si ya debería estar', async () => {
    const { run, notifications } = build({
      fetch: async (_type, periods) => ({
        source: 'bcra',
        // Falta julio, que terminó hace tres meses.
        values: periods
          .filter((p) => p !== '2026-07')
          .map((period) => ({ period, value: '2' })),
      }),
    })

    const outcome = await run()

    expect(outcome.status).toBe(JobExecutionStatus.PARTIAL)
    expect(outcome.summary).toContain('faltan 2026-07')
    // Sólo la inmobiliaria que usa ICL; el IPC no lo usa nadie.
    expect(notifications.notifyStaff).toHaveBeenCalledTimes(1)
    expect(notifications.notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        type: 'INDEX_FETCH_FAILED',
        dedupeKey: `INDEX_FETCH_FAILED:ICL:${TODAY}`,
      }),
    )
  })

  it('un mes recién terminado que todavía no se publicó no alarma (A-28)', async () => {
    const { run, notifications } = build(
      { fetch: async () => ({ source: 'indec', values: [] }) },
      { today: '2026-11-03', missing: ['2026-10'] },
    )

    const outcome = await run()

    // Queda PARTIAL (se vuelve a pedir en la próxima corrida), pero el
    // INDEC publica a mediados de mes: nadie recibe un aviso todavía.
    expect(outcome.status).toBe(JobExecutionStatus.PARTIAL)
    expect(notifications.notifyStaff).not.toHaveBeenCalled()
  })

  it('si la fuente falla, el tipo queda FAILED con el error y todo el job FAILED si fallaron los dos', async () => {
    const { run, notifications } = build({
      fetch: async () => {
        throw new IndexSourceUnavailableError('bcra', 'respondió HTTP 503')
      },
    })

    const outcome = await run()

    expect(outcome.status).toBe(JobExecutionStatus.FAILED)
    expect(outcome.details).toMatchObject({
      ICL: {
        status: IndexFetchStatus.FAILED,
        error: 'bcra: respondió HTTP 503',
      },
    })
    expect(notifications.notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('respondió HTTP 503'),
      }),
    )
  })

  it('si falla uno solo es PARTIAL', async () => {
    const { run } = build({
      fetch: async (type, periods) => {
        if (type === 'IPC') {
          throw new IndexSourceUnavailableError('indec', 'cambió el formato')
        }
        return {
          source: 'bcra',
          values: periods.map((period) => ({ period, value: '3' })),
        }
      },
    })

    expect((await run()).status).toBe(JobExecutionStatus.PARTIAL)
  })
})
