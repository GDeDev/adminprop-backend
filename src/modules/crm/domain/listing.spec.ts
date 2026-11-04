import {
  canTransition,
  ListingPayload,
  ListingStatus,
  missingForPublish,
  payloadHash,
} from './listing'

const PAYLOAD: ListingPayload = {
  propertyId: 'p1',
  title: 'Casa',
  address: 'Calle 1',
  location: 'Tolosa, La Plata',
  neighborhood: 'Tolosa',
  propertyType: 'Casa',
  price: '150000.00',
  currency: 'ARS',
  description: 'Linda',
  photoUrls: ['https://x/1.jpg'],
  amenities: ['Patio', 'Cochera'],
}

describe('missingForPublish', () => {
  it('lista todo lo que falta', () => {
    expect(
      missingForPublish({
        available: false,
        price: null,
        photoCount: 0,
        description: ' ',
      }),
    ).toHaveLength(4)
  })

  it('vacía cuando está lista', () => {
    expect(
      missingForPublish({
        available: true,
        price: '1.00',
        photoCount: 2,
        description: 'ok',
      }),
    ).toEqual([])
  })
})

describe('payloadHash', () => {
  it('es estable y no depende del orden de las comodidades', () => {
    expect(payloadHash(PAYLOAD)).toBe(
      payloadHash({ ...PAYLOAD, amenities: ['Cochera', 'Patio'] }),
    )
  })

  it('cambia si cambia el precio', () => {
    expect(payloadHash(PAYLOAD)).not.toBe(
      payloadHash({ ...PAYLOAD, price: '160000.00' }),
    )
  })
})

describe('canTransition', () => {
  it('sólo se pausa una publicada y sólo se reintenta una con error', () => {
    expect(canTransition('pause', ListingStatus.PUBLISHED)).toBe(true)
    expect(canTransition('pause', ListingStatus.PAUSED)).toBe(false)
    expect(canTransition('retry', ListingStatus.ERROR)).toBe(true)
    expect(canTransition('retry', ListingStatus.PUBLISHED)).toBe(false)
  })
})
