import { isTrustedServerSecret } from './trusted-server'

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
})
