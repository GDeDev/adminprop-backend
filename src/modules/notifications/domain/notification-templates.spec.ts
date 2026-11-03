import {
  ALL_VARIABLE_NAMES,
  DEFAULT_EMAIL_TEMPLATES,
  fillTemplate,
  renderEmail,
  renderLayout,
  safeColor,
  typeOfTemplateKey,
  unknownVariables,
} from './notification-templates'
import { NOTIFICATION_CATALOG } from './notification-catalog'

describe('plantillas por defecto', () => {
  it.each(Object.entries(DEFAULT_EMAIL_TEMPLATES))(
    '%s sólo usa variables que declara y que existen',
    (_type, template) => {
      const text = `${template!.subject}\n${template!.bodyText}`
      expect(unknownVariables(text, template!.variables)).toEqual([])
      expect(
        template!.variables.every((name) => ALL_VARIABLE_NAMES.includes(name)),
      ).toBe(true)
    },
  )

  it('toda plantilla corresponde a un tipo del catálogo con canal email', () => {
    for (const type of Object.keys(DEFAULT_EMAIL_TEMPLATES)) {
      const entry = NOTIFICATION_CATALOG.find((e) => e.type === type)
      expect(entry?.availableChannels).toContain('EMAIL')
    }
  })

  it('reconoce la clave de una plantilla y rechaza las demás', () => {
    expect(typeOfTemplateKey('PAYMENT_REMINDER.EMAIL')).toBe('PAYMENT_REMINDER')
    expect(typeOfTemplateKey('JOB_FAILED.EMAIL')).toBeNull()
    expect(typeOfTemplateKey('nada')).toBeNull()
  })
})

describe('renderEmail', () => {
  it('reemplaza variables y deja vacía la que falta', () => {
    const rendered = renderEmail(
      'Hola {{recipientName}}',
      'Debés {{amount}}{{period}}.',
      {
        recipientName: 'Ana',
        amount: '$ 100,00',
      },
    )
    expect(rendered.subject).toBe('Hola Ana')
    expect(rendered.text).toBe('Debés $ 100,00.')
  })

  it('escapa los valores en el HTML pero no en el texto', () => {
    const rendered = renderEmail('s', 'Hola {{recipientName}}', {
      recipientName: '<script>alert(1)</script> & "Co"',
    })
    expect(rendered.text).toContain('<script>')
    expect(rendered.htmlBody).not.toContain('<script>')
    expect(rendered.htmlBody).toContain('&lt;script&gt;')
    expect(rendered.htmlBody).toContain('&amp;')
  })

  it('arma párrafos con saltos de línea', () => {
    const rendered = renderEmail('s', 'Uno\nlinea\n\nDos', {})
    expect(rendered.htmlBody.match(/<p /g)).toHaveLength(2)
    expect(rendered.htmlBody).toContain('Uno<br>linea')
  })

  it('el asunto queda en una sola línea', () => {
    expect(renderEmail('A\n{{x}}', 'b', { x: 'B\r\nBcc: x' }).subject).toBe(
      'A B Bcc: x',
    )
  })

  it('no ejecuta lógica: una llave rara queda como texto', () => {
    expect(fillTemplate('{{#if x}}hola{{/if}}', { x: '1' })).toBe(
      '{{#if x}}hola{{/if}}',
    )
  })
})

describe('renderLayout', () => {
  it('usa el color de la marca y el nombre cuando no hay logo', () => {
    const html = renderLayout('<p>x</p>', {
      agencyName: 'Oppido <Prop>',
      primaryColor: '#112233',
    })
    expect(html).toContain('#112233')
    expect(html).toContain('Oppido &lt;Prop&gt;')
  })

  it('descarta un color que no sea hexadecimal (va a un atributo style)', () => {
    expect(safeColor('red;background:url(x)')).toBe('#c2410c')
    expect(safeColor('#abc')).toBe('#abc')
  })
})
