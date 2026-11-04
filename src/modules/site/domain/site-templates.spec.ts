import { contrastRatio } from './color'
import { allTemplates, defaultContent, themeFor } from './site-templates'

const TENANT = {
  name: 'Inmo',
  logoUrl: null,
  primaryColor: null,
  phone: null,
  whatsapp: null,
  address: null,
  email: null,
}

describe('templates', () => {
  it('hay dos, con tema legible (AA) y fuentes que incluyen la del tema', () => {
    const templates = allTemplates()
    expect(templates.map((t) => t.key)).toEqual(['CLASSIC', 'MODERN'])
    for (const t of templates) {
      const { defaultTheme: th } = t
      expect(contrastRatio(th.text, th.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(th.text, th.surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(th.primary, th.background)).toBeGreaterThanOrEqual(3)
      expect(t.fontOptions.map((f) => f.key)).toContain(th.fontKey)
    }
  })

  it('usa el color de la marca solo si se lee sobre el fondo del template', () => {
    expect(themeFor('CLASSIC', '#ff6600').primary).toBe('#FF6600')
    // Casi igual al fondo oscuro: no se aplica.
    expect(themeFor('CLASSIC', '#1a1e16').primary).toBe('#B6A28E')
    expect(themeFor('MODERN', 'no-es-color').primary).toBe('#1D4ED8')
    expect(themeFor('MODERN', null).primary).toBe('#1D4ED8')
  })

  it('el contenido inicial es genérico: sin números ni datos de otra inmobiliaria', () => {
    const content = defaultContent(TENANT)
    expect(content.metrics).toEqual([])
    expect(content.testimonials).toEqual([])
    expect(content.brand.displayName).toBe('Inmo')
    expect(content.contact.whatsapp).toBeNull()
    expect(content.hero.ctaLabel).toBeNull()
    expect(JSON.stringify(content).toLowerCase()).not.toContain('oppido')
  })

  it('con WhatsApp válido arma el CTA y el mensaje inicial', () => {
    const content = defaultContent({ ...TENANT, whatsapp: '5492215550000' })
    expect(content.contact.whatsapp).toBe('5492215550000')
    expect(content.hero.ctaLabel).not.toBeNull()
    expect(content.contact.whatsappMessage).toContain('Inmo')
    expect(
      defaultContent({ ...TENANT, whatsapp: '+54 221' }).contact.whatsapp,
    ).toBeNull()
  })
})
