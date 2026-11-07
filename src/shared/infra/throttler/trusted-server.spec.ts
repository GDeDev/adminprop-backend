import {
  isTrustedServerSecret,
  shouldSkipForTrustedServer,
} from './trusted-server'

describe('isTrustedServerSecret', () => {
  it('acepta solo el secreto exacto', () => {
    expect(isTrustedServerSecret('secreto-largo', 'secreto-largo')).toBe(true)
    expect(isTrustedServerSecret('secreto-largo ', 'secreto-largo')).toBe(false)
    expect(isTrustedServerSecret('otro', 'secreto-largo')).toBe(false)
    expect(isTrustedServerSecret('secreto', 'secreto-largo')).toBe(false)
  })

  it('sin secreto configurado o sin header nadie es de confianza', () => {
    expect(isTrustedServerSecret('x', null)).toBe(false)
    expect(isTrustedServerSecret('x', undefined)).toBe(false)
    expect(isTrustedServerSecret('x', '')).toBe(false)
    expect(isTrustedServerSecret(undefined, 'secreto')).toBe(false)
    expect(isTrustedServerSecret('', 'secreto')).toBe(false)
  })

  describe('con varios secretos válidos', () => {
    const both = ['secreto-server', 'secreto-revalidate']

    it('acepta el header si coincide con cualquiera de los dos', () => {
      expect(isTrustedServerSecret('secreto-server', both)).toBe(true)
      expect(isTrustedServerSecret('secreto-revalidate', both)).toBe(true)
    })

    it('rechaza uno distinto o parcial', () => {
      expect(isTrustedServerSecret('otro', both)).toBe(false)
      expect(isTrustedServerSecret('secreto-serv', both)).toBe(false)
    })

    it('no acepta un header vacío aunque haya un secreto vacío configurado', () => {
      expect(isTrustedServerSecret('', ['', 'secreto'])).toBe(false)
      expect(isTrustedServerSecret(undefined, both)).toBe(false)
    })

    it('ignora los secretos vacíos o ausentes de la lista', () => {
      expect(isTrustedServerSecret('x', ['', null, undefined])).toBe(false)
      expect(isTrustedServerSecret('secreto', [undefined, 'secreto'])).toBe(
        true,
      )
      expect(isTrustedServerSecret('x', [])).toBe(false)
    })
  })
})

describe('shouldSkipForTrustedServer', () => {
  const secrets = ['secreto-largo']

  it('con el secreto y sin X-Client-IP se saltea (lecturas cacheadas)', () => {
    expect(
      shouldSkipForTrustedServer(
        { 'x-sites-secret': 'secreto-largo' },
        secrets,
      ),
    ).toBe(true)
  })

  it('con el secreto y una X-Client-IP válida NO se saltea: cuenta por esa IP', () => {
    expect(
      shouldSkipForTrustedServer(
        { 'x-sites-secret': 'secreto-largo', 'x-client-ip': '203.0.113.9' },
        secrets,
      ),
    ).toBe(false)
  })

  it('una X-Client-IP inválida se ignora y se saltea como sin IP', () => {
    expect(
      shouldSkipForTrustedServer(
        { 'x-sites-secret': 'secreto-largo', 'x-client-ip': 'no-es-ip' },
        secrets,
      ),
    ).toBe(true)
  })

  it('sin secreto válido nunca se saltea, con o sin IP', () => {
    expect(shouldSkipForTrustedServer({}, secrets)).toBe(false)
    expect(
      shouldSkipForTrustedServer(
        { 'x-sites-secret': 'otro', 'x-client-ip': '203.0.113.9' },
        secrets,
      ),
    ).toBe(false)
  })
})
