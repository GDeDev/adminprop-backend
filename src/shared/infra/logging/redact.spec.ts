import { redact, REDACTED } from './redact'

describe('redact', () => {
  it('tapa los campos sensibles más obvios', () => {
    const result = redact({
      email: 'ana@ejemplo.com',
      password: 'secreta',
      accessToken: 'abc.def.ghi',
      apiKey: 'sk-123',
    }) as Record<string, unknown>

    expect(result.email).toBe(REDACTED)
    expect(result.password).toBe(REDACTED)
    expect(result.accessToken).toBe(REDACTED)
    expect(result.apiKey).toBe(REDACTED)
  })

  it('reconoce variantes de nombre', () => {
    const result = redact({
      newPassword: 'x',
      password_confirmation: 'x',
      'x-api-key': 'x',
      refreshToken: 'x',
    }) as Record<string, unknown>

    expect(Object.values(result)).toEqual([
      REDACTED,
      REDACTED,
      REDACTED,
      REDACTED,
    ])
  })

  it('entra en objetos y arrays anidados', () => {
    const result = redact({
      user: { name: 'Ana', credentials: { secret: 'x' } },
      items: [{ token: 'a' }, { qty: 2 }],
    }) as any

    expect(result.user.name).toBe('Ana')
    expect(result.user.credentials).toBe(REDACTED)
    expect(result.items[0].token).toBe(REDACTED)
    expect(result.items[1].qty).toBe(2)
  })

  it('no rompe con null, undefined ni primitivos', () => {
    expect(redact(null)).toBeNull()
    expect(redact(undefined)).toBeUndefined()
    expect(redact(42)).toBe(42)
    expect(redact(true)).toBe(true)
  })

  it('corta strings largas para no inundar los logs', () => {
    const result = redact({ note: 'a'.repeat(5000) }) as Record<string, string>

    expect(result.note.length).toBeLessThan(5000)
    expect(result.note).toContain('caracteres]')
  })

  it('corta arrays largos', () => {
    const result = redact({
      items: Array.from({ length: 100 }, (_, i) => i),
    }) as any

    expect(result.items.length).toBeLessThanOrEqual(26)
    expect(result.items[result.items.length - 1]).toContain('elementos]')
  })

  it('no entra en un bucle infinito con referencias circulares', () => {
    const circular: any = { name: 'raiz' }
    circular.self = circular

    expect(() => redact(circular)).not.toThrow()
  })

  it('serializa errores sin arrastrar el stack', () => {
    const result = redact({ cause: new Error('boom') }) as any

    expect(result.cause).toEqual({ name: 'Error', message: 'boom' })
  })

  // Antes dni/cbu/teléfono/email pasaban tal cual al log de un 5xx.
  it('tapa datos personales', () => {
    const result = redact({
      firstName: 'Ana',
      dni: '30111222',
      taxId: '20-30111222-3',
      cuit: '20301112223',
      bankCbu: '0170000000000000000000',
      bankAlias: 'ana.alquileres',
      phone: '1155550000',
      telefono: '1155550000',
      email: 'ana@ejemplo.com',
      address: 'Calle 1',
      page: 2,
    }) as Record<string, unknown>

    expect(result.firstName).toBe('Ana')
    expect(result.page).toBe(2)
    for (const key of Object.keys(result)) {
      if (key === 'firstName' || key === 'page') continue
      expect(result[key]).toBe(REDACTED)
    }
  })
})
