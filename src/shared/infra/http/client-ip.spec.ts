import { Request } from 'express'

import { resolveClientIp } from './client-ip'

const SECRET = 'secreto-del-servidor-de-sitios'

function req(headers: Record<string, string>, ip = '10.0.0.1'): Request {
  return { headers, ip } as unknown as Request
}

describe('resolveClientIp (D-252)', () => {
  it('sin headers propios usa req.ip (que respeta TRUST_PROXY_HOPS)', () => {
    expect(resolveClientIp(req({}), [SECRET])).toBe('10.0.0.1')
  })

  it('con el secreto de servidor, toma la IP del visitante de X-Client-IP', () => {
    expect(
      resolveClientIp(
        req({ 'x-sites-secret': SECRET, 'x-client-ip': '203.0.113.7' }),
        [SECRET],
      ),
    ).toBe('203.0.113.7')
  })

  // Si el header valiera solo, cualquiera elegiría su IP y esquivaría el tope.
  it('sin el secreto, o con uno incorrecto, ignora X-Client-IP', () => {
    expect(
      resolveClientIp(req({ 'x-client-ip': '203.0.113.7' }), [SECRET]),
    ).toBe('10.0.0.1')
    expect(
      resolveClientIp(
        req({ 'x-sites-secret': 'otro', 'x-client-ip': '203.0.113.7' }),
        [SECRET],
      ),
    ).toBe('10.0.0.1')
  })

  it('ignora un X-Client-IP que no es una IP', () => {
    expect(
      resolveClientIp(
        req({ 'x-sites-secret': SECRET, 'x-client-ip': 'no-soy-una-ip' }),
        [SECRET],
      ),
    ).toBe('10.0.0.1')
  })

  it('sin secretos configurados nunca confía en el header', () => {
    expect(
      resolveClientIp(
        req({ 'x-sites-secret': SECRET, 'x-client-ip': '203.0.113.7' }),
        [],
      ),
    ).toBe('10.0.0.1')
  })
})
