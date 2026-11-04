import { PgBossQueueAdapter } from './pg-boss.queue-adapter'

/** Un pg-boss de mentira que mide cuántos `createQueue` corren a la vez. */
function fakeBoss(failOn?: string) {
  const state = { running: 0, maxRunning: 0, created: [] as string[] }
  const boss = {
    start: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn(async (name: string) => {
      state.running += 1
      state.maxRunning = Math.max(state.maxRunning, state.running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      state.running -= 1
      if (name === failOn) throw new Error('create_queue falló')
      state.created.push(name)
    }),
  }
  return { boss, state }
}

function adapterWith(boss: unknown): PgBossQueueAdapter {
  const adapter = new PgBossQueueAdapter('postgresql://nadie@localhost/nada')
  return Object.assign(adapter, { boss })
}

describe('PgBossQueueAdapter.declare', () => {
  it('serializa las declaraciones de colas distintas (deadlock de create_queue)', async () => {
    const { boss, state } = fakeBoss()
    const adapter = adapterWith(boss)

    await Promise.all(
      ['a', 'b', 'c', 'd'].map((name) => adapter.declare({ name })),
    )

    // Sin la cadena, las 8 llamadas (cola + dead-letter) corrían a la vez.
    expect(state.maxRunning).toBe(1)
    expect(state.created).toHaveLength(8)
  })

  it('declara la dead-letter antes que su cola', async () => {
    const { boss, state } = fakeBoss()
    await adapterWith(boss).declare({ name: 'pagos' })

    expect(state.created).toHaveLength(2)
    expect(state.created[0]).not.toBe('pagos')
    expect(state.created[1]).toBe('pagos')
  })

  it('no vuelve a declarar la misma cola', async () => {
    const { boss } = fakeBoss()
    const adapter = adapterWith(boss)

    await Promise.all([
      adapter.declare({ name: 'x' }),
      adapter.declare({ name: 'x' }),
    ])
    await adapter.declare({ name: 'x' })

    expect(boss.createQueue).toHaveBeenCalledTimes(2)
  })

  it('una declaración que falla no bloquea las siguientes', async () => {
    const { boss, state } = fakeBoss('rota')
    const adapter = adapterWith(boss)

    const broken = adapter.declare({ name: 'rota' })
    const healthy = adapter.declare({ name: 'sana' })

    await expect(broken).rejects.toThrow('create_queue falló')
    await expect(healthy).resolves.toBeUndefined()
    expect(state.created).toContain('sana')
  })
})
