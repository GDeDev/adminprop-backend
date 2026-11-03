import { INQUIRY_LIMIT } from './public-inquiry'
import { PublicInquiryPolicy } from './public-inquiry.policy'

describe('PublicInquiryPolicy', () => {
  describe('honeypot', () => {
    it('vacío o sólo espacios es una persona', () => {
      expect(PublicInquiryPolicy.isBot('')).toBe(false)
      expect(PublicInquiryPolicy.isBot('   ')).toBe(false)
      expect(PublicInquiryPolicy.isBot(undefined)).toBe(false)
      expect(PublicInquiryPolicy.isBot(null)).toBe(false)
    })

    it('con cualquier texto es un bot', () => {
      expect(PublicInquiryPolicy.isBot('http://spam.example')).toBe(true)
    })
  })

  describe('normalización', () => {
    it('limpia espacios, pasa el email a minúsculas y deja una sola línea en nombre y teléfono', () => {
      expect(
        PublicInquiryPolicy.normalize({
          name: '  Ana \n  Pérez ',
          email: '  ANA@Mail.COM ',
          phone: ' 221  555\n1234 ',
          message: '  Hola\r\n\r\n\r\n\r\nme interesa  ',
        }),
      ).toEqual({
        name: 'Ana Pérez',
        email: 'ana@mail.com',
        phone: '221 555 1234',
        message: 'Hola\n\nme interesa',
      })
    })
  })

  describe('límite', () => {
    it('deja pasar mientras ambos contadores estén por debajo', () => {
      expect(
        PublicInquiryPolicy.isOverLimit(INQUIRY_LIMIT - 1, INQUIRY_LIMIT - 1),
      ).toBe(false)
    })

    it('frena si se llegó al tope por IP o por email', () => {
      expect(PublicInquiryPolicy.isOverLimit(INQUIRY_LIMIT, 0)).toBe(true)
      expect(PublicInquiryPolicy.isOverLimit(0, INQUIRY_LIMIT)).toBe(true)
    })
  })
})
