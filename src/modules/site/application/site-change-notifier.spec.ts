import { SiteChangeNotifier } from './site-change-notifier'

const flush = () => new Promise((resolve) => setImmediate(resolve))

function build(revalidate: () => Promise<void>) {
  const port = { revalidate: jest.fn(revalidate) }
  const drafts = {
    tenantData: jest.fn().mockResolvedValue({ slug: 'mi-inmo' }),
  }
  const notifier = new SiteChangeNotifier(port as never, drafts as never)
  return { notifier, port }
}

describe('SiteChangeNotifier', () => {
  it('no espera al aviso: vuelve aunque la otra app tarde', async () => {
    let finish: () => void = () => undefined
    const { notifier, port } = build(
      () => new Promise<void>((resolve) => (finish = resolve)),
    )

    // Si esperara la promesa del puerto, este await no volvería nunca.
    await notifier.notify()

    expect(port.revalidate).toHaveBeenCalledWith('mi-inmo')
    finish()
  })

  it('un aviso que falla se loguea y no rompe a quien publicó', async () => {
    const { notifier, port } = build(() => Promise.reject(new Error('caída')))

    await expect(notifier.notify()).resolves.toBeUndefined()
    await flush()

    expect(port.revalidate).toHaveBeenCalledTimes(1)
  })

  it('una excepción síncrona del puerto tampoco rompe', async () => {
    const port = {
      revalidate: jest.fn(() => {
        throw new Error('sync')
      }),
    }
    const drafts = { tenantData: jest.fn().mockResolvedValue({ slug: 'a' }) }
    const notifier = new SiteChangeNotifier(port as never, drafts as never)

    await expect(notifier.notify()).resolves.toBeUndefined()
    await flush()
    expect(port.revalidate).toHaveBeenCalledWith('a')
  })
})
