import { SiteHostPolicy } from './site-host.policy'

describe('SiteHostPolicy', () => {
  it.each([
    ['mi-inmo', true],
    ['  Mi-Inmo ', true],
    ['abc', true],
    ['ab', false],
    ['-abc', false],
    ['abc-', false],
    ['a_b', false],
    ['a.b', false],
    ['ñandú', false],
    ['a--b', false],
    ['www', false],
    ['admin', false],
    ['x'.repeat(64), false],
  ])('subdominio %j → %s', (raw, ok) => {
    expect(SiteHostPolicy.checkSubdomain(raw).ok).toBe(ok)
  })

  it('normaliza el subdominio a minúsculas', () => {
    expect(SiteHostPolicy.checkSubdomain('  Mi-Inmo ')).toEqual({
      ok: true,
      value: 'mi-inmo',
    })
  })

  it.each([
    ['www.tuinmo.com.ar', true],
    ['TuInmo.com', true],
    ['https://tuinmo.com', false],
    ['tuinmo.com/ruta', false],
    ['tuinmo', false],
    ['192.168.0.1', false],
    ['localhost', false],
    ['a.localhost', false],
    ['adminprop.com', false],
    ['x.adminprop.com', false],
    ['mi dominio.com', false],
  ])('dominio propio %j → %s', (raw, ok) => {
    expect(SiteHostPolicy.checkCustomDomain(raw, 'adminprop.com').ok).toBe(ok)
  })

  it('normaliza el host: minúsculas, sin puerto ni punto final', () => {
    expect(SiteHostPolicy.normalizeHost('Foo.com.:3003')).toBe('foo.com')
    expect(SiteHostPolicy.normalizeHost('Foo.Adminprop.com:3003')).toBe(
      'foo.adminprop.com',
    )
    expect(SiteHostPolicy.normalizeHost('foo.com.')).toBe('foo.com')
  })

  it('subdomainOf separa solo un nivel bajo el dominio base', () => {
    expect(
      SiteHostPolicy.subdomainOf('mi.adminprop.com', 'adminprop.com'),
    ).toBe('mi')
    expect(
      SiteHostPolicy.subdomainOf('a.b.adminprop.com', 'adminprop.com'),
    ).toBeNull()
    expect(
      SiteHostPolicy.subdomainOf('adminprop.com', 'adminprop.com'),
    ).toBeNull()
    expect(SiteHostPolicy.subdomainOf('otro.com', 'adminprop.com')).toBeNull()
    expect(SiteHostPolicy.subdomainOf('mi.adminprop.com', null)).toBeNull()
  })
})
