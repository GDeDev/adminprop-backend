import { SiteHostResolver } from './site-host-resolver'

function build(options: { baseDomain?: string | null } = {}) {
  const published: Record<string, string> = {}
  const settings = {
    findPublishedByHost: jest.fn(
      async (by: { subdomain?: string; customDomain?: string }) => {
        const key = by.subdomain ?? by.customDomain ?? ''
        return published[key] ? { tenantId: published[key] } : null
      },
    ),
  }
  const tenants = {
    findActiveById: jest.fn(async (id: string) =>
      id === 'inactive' ? null : { id, slug: `slug-${id}` },
    ),
  }
  const urls = {
    baseDomain:
      options.baseDomain === undefined ? 'adminprop.com' : options.baseDomain,
  }
  const resolver = new SiteHostResolver(
    settings as never,
    tenants as never,
    urls as never,
  )
  return { resolver, settings, tenants, published }
}

describe('SiteHostResolver', () => {
  it('resuelve <subdominio>.<dominio base> y dominios propios', async () => {
    const { resolver, published } = build()
    published['mi-inmo'] = 't1'
    published['inmo.com.ar'] = 't2'

    expect(await resolver.resolve('Mi-Inmo.adminprop.com:443')).toBe('slug-t1')
    expect(await resolver.resolve('inmo.com.ar')).toBe('slug-t2')
  })

  it('www.<dominio> abre el sitio de <dominio> y al revés', async () => {
    const { resolver, published } = build()
    published['inmo.com.ar'] = 't2'
    published['www.otra.com'] = 't3'

    expect(await resolver.resolve('www.inmo.com.ar')).toBe('slug-t2')
    expect(await resolver.resolve('otra.com')).toBe('slug-t3')
  })

  it('un host desconocido, vacío o de una inmobiliaria inactiva es null', async () => {
    const { resolver, published } = build()
    published['baja'] = 'inactive'

    expect(await resolver.resolve('nadie.adminprop.com')).toBeNull()
    expect(await resolver.resolve('baja.adminprop.com')).toBeNull()
    expect(await resolver.resolve('')).toBeNull()
    expect(await resolver.resolve('a.b.adminprop.com')).toBeNull()
  })

  it('sin dominio base, <algo>.adminprop.com se trata como dominio propio', async () => {
    const { resolver, settings } = build({ baseDomain: null })
    expect(await resolver.resolve('mi.adminprop.com')).toBeNull()
    expect(settings.findPublishedByHost).toHaveBeenCalledWith({
      customDomain: 'mi.adminprop.com',
    })
  })

  it('cachea aciertos y fallos, y olvida todo al invalidar', async () => {
    const { resolver, settings, published } = build()
    published['mi'] = 't1'

    await resolver.resolve('mi.adminprop.com')
    await resolver.resolve('mi.adminprop.com')
    expect(settings.findPublishedByHost).toHaveBeenCalledTimes(1)

    await resolver.resolve('no.adminprop.com')
    await resolver.resolve('no.adminprop.com')
    expect(settings.findPublishedByHost).toHaveBeenCalledTimes(2)

    delete published['mi']
    resolver.invalidate()
    expect(await resolver.resolve('mi.adminprop.com')).toBeNull()
  })
})
