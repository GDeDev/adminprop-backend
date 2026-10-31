import { BcraIclAdapter, parsePoints as parseIcl } from './bcra-icl.adapter'
import { IndecIpcAdapter, parsePoints as parseIpc } from './indec-ipc.adapter'
import { IndexSourceUnavailableError } from '../index-source.port'

const mockFetch = (body: unknown, status = 200) =>
  jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    }),
  )

afterEach(() => jest.restoreAllMocks())

describe('BcraIclAdapter', () => {
  const v3 = {
    status: 200,
    results: [
      {
        idVariable: 40,
        detalle: [
          { fecha: '2026-08-29', valor: 12.1 },
          { fecha: '2026-08-31', valor: 12.5 },
          { fecha: '2026-09-30', valor: 13.25 },
          { fecha: '2026-10-02', valor: 13.4 },
        ],
      },
    ],
  }

  it('toma el valor del último día de cada mes ya terminado', async () => {
    mockFetch(v3)
    const adapter = new BcraIclAdapter(() => '2026-10-15')

    const result = await adapter.fetch(['2026-08', '2026-09', '2026-10'])

    expect(result).toEqual({
      source: 'bcra',
      values: [
        { period: '2026-08', value: '12.5' },
        { period: '2026-09', value: '13.25' },
      ],
    })
  })

  it('no informa un mes sin dato en sus últimos días', async () => {
    mockFetch({
      results: [{ detalle: [{ fecha: '2026-08-10', valor: 11 }] }],
    })
    const adapter = new BcraIclAdapter(() => '2026-10-15')

    expect((await adapter.fetch(['2026-08'])).values).toEqual([])
  })

  it('entiende también el formato v2 (results planos)', () => {
    expect(
      parseIcl({ results: [{ fecha: '2026-08-31', valor: 12.5 }] }),
    ).toEqual([{ fecha: '2026-08-31', valor: 12.5 }])
  })

  it('un cambio de formato falla con la fuente en el mensaje', async () => {
    mockFetch({ otra: 'cosa' })
    await expect(
      new BcraIclAdapter(() => '2026-10-15').fetch(['2026-08']),
    ).rejects.toThrow(IndexSourceUnavailableError)
    await expect(
      new BcraIclAdapter(() => '2026-10-15').fetch(['2026-08']),
    ).rejects.toThrow(/^bcra: /)
  })

  it('un HTTP de error o una red caída también', async () => {
    mockFetch('error', 503)
    await expect(new BcraIclAdapter().fetch(['2026-08'])).rejects.toThrow(
      /HTTP 503/,
    )

    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'))
    await expect(new BcraIclAdapter().fetch(['2026-08'])).rejects.toThrow(
      /no se pudo conectar/,
    )
  })
})

describe('IndecIpcAdapter', () => {
  it('devuelve el índice de cada mes publicado', async () => {
    mockFetch({
      data: [
        ['2026-08-01', 7000.5],
        ['2026-09-01', 7100],
      ],
    })

    const result = await new IndecIpcAdapter().fetch([
      '2026-08',
      '2026-09',
      '2026-10',
    ])

    expect(result).toEqual({
      source: 'indec',
      values: [
        { period: '2026-08', value: '7000.5' },
        { period: '2026-09', value: '7100' },
      ],
    })
  })

  it('ignora los meses sin dato (null) y rechaza basura', () => {
    expect(parseIpc({ data: [['2026-10-01', null]] })).toEqual([])
    expect(() => parseIpc({ data: [['mañana', 1]] })).toThrow(
      IndexSourceUnavailableError,
    )
    expect(() => parseIpc({})).toThrow(/^indec: /)
  })
})
