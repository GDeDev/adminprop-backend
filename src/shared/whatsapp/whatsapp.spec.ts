import { buildWhatsAppLink, fillTemplate } from './whatsapp'

describe('buildWhatsAppLink', () => {
  it('normaliza los formatos argentinos habituales', () => {
    expect(buildWhatsAppLink('011 15 1234-5678', 'Hola')).toBe(
      'https://wa.me/5491112345678?text=Hola',
    )
    expect(buildWhatsAppLink('+54 9 11 1234-5678', 'Hola')).toBe(
      'https://wa.me/5491112345678?text=Hola',
    )
    expect(buildWhatsAppLink('1123456789', 'Hola')).toBe(
      'https://wa.me/5491123456789?text=Hola',
    )
    expect(buildWhatsAppLink('54 11 1234 5678', 'x')).toBe(
      'https://wa.me/5491112345678?text=x',
    )
    expect(buildWhatsAppLink('0054 9 221 555 1234', 'x')).toBe(
      'https://wa.me/5492215551234?text=x',
    )
  })

  it('quita el 15 con característica de 3 y 4 dígitos', () => {
    expect(buildWhatsAppLink('0221 15 555-1234', 'x')).toBe(
      'https://wa.me/5492215551234?text=x',
    )
    expect(buildWhatsAppLink('(02966) 15-45-1234', 'x')).toBe(
      'https://wa.me/5492966451234?text=x',
    )
  })

  it('codifica el mensaje', () => {
    expect(buildWhatsAppLink('1123456789', 'Hola Ana, ¿cómo estás?')).toBe(
      `https://wa.me/5491123456789?text=${encodeURIComponent('Hola Ana, ¿cómo estás?')}`,
    )
  })

  it('sin mensaje no agrega text', () => {
    expect(buildWhatsAppLink('1123456789')).toBe('https://wa.me/5491123456789')
    expect(buildWhatsAppLink('1123456789', '')).toBe(
      'https://wa.me/5491123456789',
    )
  })

  it('respeta otros países cuando viene con +', () => {
    expect(buildWhatsAppLink('+598 99 123 456', 'x')).toBe(
      'https://wa.me/59899123456?text=x',
    )
  })

  it('devuelve null sin teléfono o con algo que no es un número', () => {
    expect(buildWhatsAppLink(null, 'x')).toBeNull()
    expect(buildWhatsAppLink(undefined, 'x')).toBeNull()
    expect(buildWhatsAppLink('', 'x')).toBeNull()
    expect(buildWhatsAppLink('consultar', 'x')).toBeNull()
    expect(buildWhatsAppLink('123', 'x')).toBeNull()
  })
})

describe('fillTemplate', () => {
  it('reemplaza variables y deja vacías las que faltan', () => {
    expect(
      fillTemplate('Hola {{recipientName}}, debés {{ amount }}{{x}}.', {
        recipientName: 'Ana',
        amount: '$ 100,00',
      }),
    ).toBe('Hola Ana, debés $ 100,00.')
  })
})
