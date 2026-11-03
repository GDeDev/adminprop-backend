import {
  decideDelivery,
  MAX_DELIVERY_ATTEMPTS,
  retryDelaySeconds,
} from './delivery-policy'
import { findCatalogEntry } from './notification-catalog'

const entry = (type: string) => findCatalogEntry(type)!

describe('decideDelivery', () => {
  it('sale por los canales pedidos cuando todo está al día', () => {
    expect(
      decideDelivery({
        entry: entry('PAYMENT_REMINDER'),
        requestedChannels: ['EMAIL', 'WHATSAPP_LINK'],
        email: 'a@b.com',
        phone: '1123456789',
      }),
    ).toEqual({ send: true, channels: ['EMAIL', 'WHATSAPP_LINK'] })
  })

  it('un tipo apagado por la inmobiliaria queda TYPE_DISABLED', () => {
    expect(
      decideDelivery({
        entry: entry('PAYMENT_REMINDER'),
        requestedChannels: ['EMAIL'],
        setting: { enabled: false, channels: ['EMAIL'] },
        email: 'a@b.com',
      }),
    ).toEqual({ send: false, reason: 'TYPE_DISABLED' })
  })

  it('PAYMENT_RECEIVED viene apagado por defecto (A-54)', () => {
    expect(
      decideDelivery({
        entry: entry('PAYMENT_RECEIVED'),
        requestedChannels: ['EMAIL'],
        email: 'a@b.com',
      }),
    ).toEqual({ send: false, reason: 'TYPE_DISABLED' })
  })

  it('un tipo obligatorio ignora un setting apagado', () => {
    expect(
      decideDelivery({
        entry: entry('INSURER_ALERT'),
        requestedChannels: ['EMAIL'],
        setting: { enabled: false, channels: ['EMAIL'] },
        email: 'seguros@x.com',
      }),
    ).toEqual({ send: true, channels: ['EMAIL'] })
  })

  it('un canal que la inmobiliaria sacó queda CHANNEL_DISABLED', () => {
    expect(
      decideDelivery({
        entry: entry('PAYMENT_REMINDER'),
        requestedChannels: ['EMAIL'],
        setting: { enabled: true, channels: ['WHATSAPP_LINK'] },
        email: 'a@b.com',
      }),
    ).toEqual({ send: false, reason: 'CHANNEL_DISABLED' })
  })

  it('el opt-out del usuario apaga el email pero no el in-app', () => {
    const base = {
      entry: entry('STATEMENT_PENDING'),
      setting: {
        enabled: true,
        channels: ['IN_APP', 'EMAIL'] as ('IN_APP' | 'EMAIL')[],
      },
      userPreference: { emailEnabled: false, inAppEnabled: true },
      email: 'p@x.com',
    }
    expect(decideDelivery({ ...base, requestedChannels: ['EMAIL'] })).toEqual({
      send: false,
      reason: 'USER_OPTED_OUT',
    })
    expect(
      decideDelivery({ ...base, requestedChannels: ['IN_APP', 'EMAIL'] }),
    ).toEqual({ send: true, channels: ['IN_APP'] })
  })

  it('la preferencia personal no puede apagar un tipo obligatorio', () => {
    expect(
      decideDelivery({
        entry: entry('ARREARS_NOTICE'),
        requestedChannels: ['EMAIL'],
        userPreference: { emailEnabled: false, inAppEnabled: false },
        email: 'p@x.com',
      }),
    ).toEqual({ send: true, channels: ['EMAIL'] })
  })

  it('sin email queda NO_RECIPIENT_EMAIL aunque tenga teléfono', () => {
    expect(
      decideDelivery({
        entry: entry('PAYMENT_REMINDER'),
        requestedChannels: ['EMAIL', 'WHATSAPP_LINK'],
        email: null,
        phone: '1123456789',
      }),
    ).toEqual({ send: false, reason: 'NO_RECIPIENT_EMAIL' })
  })

  it('un canal WhatsApp sin teléfono queda NO_PHONE', () => {
    expect(
      decideDelivery({
        entry: entry('PAYMENT_REMINDER'),
        requestedChannels: ['WHATSAPP_LINK'],
        phone: ' ',
      }),
    ).toEqual({ send: false, reason: 'NO_PHONE' })
  })
})

describe('retryDelaySeconds', () => {
  it('espera 1, 5 y 30 minutos y después se agota', () => {
    expect(retryDelaySeconds(1)).toBe(60)
    expect(retryDelaySeconds(2)).toBe(300)
    expect(retryDelaySeconds(3)).toBe(1800)
    expect(retryDelaySeconds(MAX_DELIVERY_ATTEMPTS)).toBeNull()
    expect(MAX_DELIVERY_ATTEMPTS).toBe(4)
  })
})
