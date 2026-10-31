import { IndexType, IndexValue } from '../domain/index-value'
import { IndexValueRepository } from '../domain/index-value.ports'
import { IndicesFacade } from './indices.facade'

function repoWith(periods: string[]): IndexValueRepository {
  const rows: IndexValue[] = periods.map((period) => ({
    id: period,
    indexType: IndexType.ICL,
    period,
    value: '1.000000',
    source: 'manual',
    createdAt: new Date(),
  }))
  return {
    find: async (_t: IndexType, period: string) =>
      rows.find((r) => r.period === period) ?? null,
    listByType: async () => rows,
    create: jest.fn(async (data) => ({
      ...rows[0],
      ...data,
      id: 'new',
      createdAt: new Date(),
    })),
  } as unknown as IndexValueRepository
}

describe('IndicesFacade', () => {
  it('missingPeriods mira los últimos N meses terminados, no el en curso', async () => {
    const facade = new IndicesFacade(repoWith(['2026-08']))

    expect(await facade.missingPeriods(IndexType.ICL, 3, '2026-10-15')).toEqual(
      ['2026-07', '2026-09'],
    )
  })

  it('missingPeriods cruza el año', async () => {
    const facade = new IndicesFacade(repoWith([]))

    expect(await facade.missingPeriods(IndexType.ICL, 3, '2027-01-02')).toEqual(
      ['2026-10', '2026-11', '2026-12'],
    )
  })

  it('registerFromSource no pisa un mes cargado', async () => {
    const repo = repoWith(['2026-08'])
    const facade = new IndicesFacade(repo)

    expect(
      await facade.registerFromSource(IndexType.ICL, '2026-08', '9', 'bcra'),
    ).toBe(false)
    expect(
      await facade.registerFromSource(IndexType.ICL, '2026-09', '9', 'bcra'),
    ).toBe(true)
    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        period: '2026-09',
        value: '9.000000',
        source: 'bcra',
      }),
    )
  })
})
