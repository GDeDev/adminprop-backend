import {
  mergeDraft,
  sameDraft,
  SiteValidationContext,
  validateSiteDraft,
} from './site-content.policy'
import { defaultDraft, templateInfo } from './site-templates'
import { SiteSettingsDraft } from './site.types'

const TENANT = {
  name: 'Inmobiliaria Test',
  logoUrl: null,
  primaryColor: '#B6A28E',
  phone: '221 555 0000',
  whatsapp: '5492215550000',
  address: 'Calle 7 123',
  email: 'info@test.com',
}

const ctx = (
  over: Partial<SiteValidationContext> = {},
): SiteValidationContext => ({
  fontKeys: ['system', 'serif', 'humanist'],
  supportedSections: templateInfo('CLASSIC').supportedSections,
  isAllowedImageUrl: (url) => url.startsWith('https://cdn.test/'),
  ...over,
})

const draft = (): SiteSettingsDraft => defaultDraft('CLASSIC', TENANT)

function errorsOf(
  input: unknown,
  options?: { forPublish?: boolean },
  c = ctx(),
) {
  const result = validateSiteDraft(input, c, options)
  return result.ok ? [] : result.errors
}

describe('validateSiteDraft', () => {
  it('el borrador inicial de cada template es válido y publicable', () => {
    for (const key of ['CLASSIC', 'MODERN'] as const) {
      const info = templateInfo(key)
      const c = ctx({
        fontKeys: info.fontOptions.map((f) => f.key),
        supportedSections: info.supportedSections,
      })
      const initial = defaultDraft(key, TENANT)
      expect(errorsOf(initial, undefined, c)).toEqual([])
      expect(errorsOf(initial, { forPublish: true }, c)).toEqual([])
    }
  })

  it('el borrador inicial de una inmobiliaria sin datos de contacto también se puede publicar', () => {
    const bare = defaultDraft('MODERN', {
      name: 'Sin datos',
      logoUrl: null,
      primaryColor: null,
      phone: null,
      whatsapp: null,
      address: null,
      email: null,
    })
    const info = templateInfo('MODERN')
    const c = ctx({
      fontKeys: info.fontOptions.map((f) => f.key),
      supportedSections: info.supportedSections,
    })
    expect(errorsOf(bare, { forPublish: true }, c)).toEqual([])
  })

  it('rechaza HTML y scripts en cualquier texto (solo texto plano)', () => {
    const attacks = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'hola <b>mundo</b>',
      '<!-- x -->',
      '<?php ?>',
      '< script>',
    ]
    for (const attack of attacks) {
      const d = draft()
      d.content.hero.title = attack
      d.content.faqs[0].answer = attack
      d.content.brand.displayName = attack
      d.content.testimonials = [
        { name: attack, text: attack, role: attack, photoUrl: null },
      ]
      const fields = errorsOf(d).map((e) => e.field)
      expect(fields).toEqual(
        expect.arrayContaining([
          'content.hero.title',
          'content.faqs[0].answer',
          'content.brand.displayName',
          'content.testimonials[0].name',
          'content.testimonials[0].text',
          'content.testimonials[0].role',
        ]),
      )
    }
  })

  it('un "menor que" suelto en un texto sigue siendo texto válido', () => {
    const d = draft()
    d.content.hero.subtitle = 'Departamentos < 50 m² desde 3 > 2 ambientes'
    expect(errorsOf(d)).toEqual([])
  })

  it('rechaza caracteres de control y saltos de línea en campos de una línea', () => {
    const d = draft()
    d.content.hero.title = 'a\u0000b'
    d.content.hero.subtitle = 'una\nlínea'
    d.content.faqs[0].answer = 'varias\nlíneas ok'
    const fields = errorsOf(d).map((e) => e.field)
    expect(fields).toContain('content.hero.title')
    expect(fields).toContain('content.hero.subtitle')
    expect(fields).not.toContain('content.faqs[0].answer')
  })

  it('respeta los largos y las cantidades máximas', () => {
    const d = draft()
    d.content.hero.title = 'x'.repeat(121)
    d.content.steps = Array.from({ length: 7 }, () => ({
      title: 'a',
      description: 'b',
      icon: 'home',
    }))
    d.content.faqs = Array.from({ length: 21 }, () => ({
      question: 'q',
      answer: 'a',
    }))
    d.content.metrics = Array.from({ length: 5 }, () => ({
      value: '1',
      label: 'x',
    }))
    const fields = errorsOf(d).map((e) => e.field)
    expect(fields).toEqual(
      expect.arrayContaining([
        'content.hero.title',
        'content.steps',
        'content.faqs',
        'content.metrics',
      ]),
    )
  })

  it('no admite claves de más (lista blanca de la forma)', () => {
    const d = draft() as unknown as Record<string, unknown>
    ;(d.content as Record<string, unknown>).evil = { x: 1 }
    ;(d.theme as Record<string, unknown>).background2 = '#000000'
    d.extra = true
    const fields = errorsOf(d).map((e) => e.field)
    expect(fields).toEqual(
      expect.arrayContaining(['content.evil', 'theme.background2', '.extra']),
    )
  })

  it('valida colores, tipografía y esquinas', () => {
    const d = draft()
    d.theme.primary = 'rojo'
    d.theme.background = '#FFF'
    d.theme.fontKey = 'comic'
    d.theme.radius = 5
    const fields = errorsOf(d).map((e) => e.field)
    expect(fields).toEqual(
      expect.arrayContaining([
        'theme.primary',
        'theme.background',
        'theme.fontKey',
        'theme.radius',
      ]),
    )
  })

  it('las redes sociales exigen https y el dominio de la red', () => {
    const d = draft()
    d.content.contact.socials = [
      { network: 'INSTAGRAM', url: 'http://instagram.com/x' },
      { network: 'FACEBOOK', url: 'https://evil.com/facebook.com' },
      { network: 'YOUTUBE', url: 'javascript:alert(1)' },
      { network: 'TIKTOK', url: 'https://user:pw@tiktok.com/@x' },
      { network: 'X', url: 'https://twitter.com/x' },
      { network: 'LINKEDIN', url: 'https://www.linkedin.com/company/x' },
    ]
    const fields = errorsOf(d).map((e) => e.field)
    expect(fields).toEqual([
      'content.contact.socials[0].url',
      'content.contact.socials[1].url',
      'content.contact.socials[2].url',
      'content.contact.socials[3].url',
    ])
  })

  it('valida teléfono, WhatsApp y email', () => {
    const d = draft()
    d.content.contact.phone = 'llamame'
    d.content.contact.whatsapp = '+54 9 221'
    d.content.contact.email = 'no-es-un-mail'
    const fields = errorsOf(d).map((e) => e.field)
    expect(fields).toEqual([
      'content.contact.phone',
      'content.contact.whatsapp',
      'content.contact.email',
    ])
  })

  it('las imágenes tienen que ser propias o de un host permitido', () => {
    const d = draft()
    d.content.hero.backgroundImageUrl = 'https://cdn.test/a.jpg'
    d.content.about.imageUrl = 'https://evil.test/a.jpg'
    d.content.services[0].imageUrl = 'javascript:alert(1)'
    d.content.seo.ogImageUrl = 'data:image/png;base64,AAAA'
    const fields = errorsOf(d).map((e) => e.field)
    expect(fields.sort()).toEqual([
      'content.about.imageUrl',
      'content.seo.ogImageUrl',
      'content.services[0].imageUrl',
    ])
  })

  it('los íconos salen de la lista cerrada y las secciones del template, sin repetir', () => {
    const d = draft()
    d.content.steps[0].icon = 'script'
    d.content.sections = [
      { key: 'hero', visible: true },
      { key: 'hero', visible: true },
      { key: 'nope' as never, visible: true },
    ]
    const fields = errorsOf(d).map((e) => e.field)
    expect(fields).toEqual(
      expect.arrayContaining([
        'content.steps[0].icon',
        'content.sections[1].key',
        'content.sections[2].key',
      ]),
    )
  })

  it('destacadas: la cantidad va de 3 a 12 y los ids tienen que ser UUID', () => {
    const d = draft()
    d.content.featured.count = 2
    d.content.featured.propertyIds = ['no-uuid']
    const fields = errorsOf(d).map((e) => e.field)
    expect(fields).toEqual(
      expect.arrayContaining([
        'content.featured.count',
        'content.featured.propertyIds[0]',
      ]),
    )
  })

  it('normaliza: recorta espacios y vacíos pasan a null', () => {
    const d = draft()
    d.content.hero.title = '  Hola  '
    d.content.hero.subtitle = '   '
    const result = validateSiteDraft(d, ctx())
    expect(result.ok && result.value.content.hero).toMatchObject({
      title: 'Hola',
      subtitle: null,
    })
  })

  describe('al publicar', () => {
    it('no deja publicar una sección visible y vacía', () => {
      const d = draft()
      d.content.sections = d.content.sections.map((s) => ({
        ...s,
        visible: true,
      }))
      const fields = errorsOf(d, { forPublish: true }).map((e) => e.field)
      expect(fields).toEqual(
        expect.arrayContaining([
          'content.metrics',
          'content.testimonials',
          'content.about.body',
        ]),
      )
      expect(errorsOf(d)).toEqual([]) // como borrador sí se guarda
    })

    it('"a mano" sin propiedades no se publica', () => {
      const d = draft()
      d.content.featured.mode = 'MANUAL'
      expect(errorsOf(d, { forPublish: true }).map((e) => e.field)).toContain(
        'content.featured.propertyIds',
      )
    })

    it('exige título y descripción SEO', () => {
      const d = draft()
      d.content.seo = { title: '', description: '', ogImageUrl: null }
      expect(errorsOf(d)).toEqual([])
      expect(errorsOf(d, { forPublish: true }).map((e) => e.field)).toEqual([
        'content.seo.title',
        'content.seo.description',
      ])
    })

    it('exige contraste AA entre el texto y sus fondos', () => {
      const d = draft()
      d.theme.text = '#777777'
      d.theme.background = '#888888'
      d.theme.surface = '#999999'
      d.theme.primary = '#898989'
      const fields = errorsOf(d, { forPublish: true }).map((e) => e.field)
      expect(fields).toEqual(['theme.text', 'theme.surface', 'theme.primary'])
    })
  })
})

describe('mergeDraft', () => {
  it('mezcla el tema campo a campo y reemplaza cada bloque de contenido entero', () => {
    const current = draft()
    const merged = mergeDraft(current, {
      theme: { primary: '#112233' },
      content: { hero: { ...current.content.hero, title: 'Nuevo' } },
    }) as SiteSettingsDraft
    expect(merged.theme).toEqual({ ...current.theme, primary: '#112233' })
    expect(merged.content.hero.title).toBe('Nuevo')
    expect(merged.content.faqs).toEqual(current.content.faqs)
    expect(merged.template).toBe('CLASSIC')
  })
})

describe('sameDraft', () => {
  it('ignora el orden de las claves', () => {
    const a = draft()
    const b = JSON.parse(JSON.stringify(a)) as SiteSettingsDraft
    const reordered = {
      content: b.content,
      theme: b.theme,
      template: b.template,
    }
    expect(sameDraft(a, reordered)).toBe(true)
    reordered.theme.radius = 24
    expect(sameDraft(a, reordered)).toBe(false)
  })
})
