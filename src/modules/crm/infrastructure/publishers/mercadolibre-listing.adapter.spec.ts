import {
  ChannelUnavailableError,
  ListingRejectedError,
  TokenExpiredError,
} from '../../domain/listing-publisher.port'
import { ListingPayload } from '../../domain/listing'
import {
  ML_DEFAULT_RENTAL_CATEGORY,
  MercadoLibreListingAdapter,
} from './mercadolibre-listing.adapter'

const SETTINGS = {
  appId: '123',
  clientSecret: 'secret',
  redirectUri: 'https://api.local/api/v1/crm/channels/mercadolibre/callback',
}
const TOKENS = { accessToken: 'at', refreshToken: 'rt', expiresAt: null }
const LISTING: ListingPayload = {
  propertyId: 'p1',
  title: 'Casa en alquiler en Calle 1',
  address: 'Calle 1',
  location: 'Tolosa, La Plata',
  neighborhood: 'Tolosa',
  propertyType: 'Casa',
  price: '150000.00',
  currency: 'ARS',
  description: 'Linda',
  photoUrls: ['https://x/1.jpg'],
  amenities: ['Patio'],
}

function respond(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe('MercadoLibreListingAdapter (sin red: fetch simulado)', () => {
  const original = global.fetch
  afterEach(() => {
    global.fetch = original
  })

  it('arma la URL de autorización con el state y el redirect', () => {
    const url = new URL(
      new MercadoLibreListingAdapter(SETTINGS).authorizeUrl('abc'),
    )
    expect(url.origin + url.pathname).toBe(
      'https://auth.mercadolibre.com.ar/authorization',
    )
    expect(url.searchParams.get('client_id')).toBe('123')
    expect(url.searchParams.get('state')).toBe('abc')
    expect(url.searchParams.get('redirect_uri')).toBe(SETTINGS.redirectUri)
  })

  it('sin credenciales configuradas dice qué falta', () => {
    expect(() =>
      new MercadoLibreListingAdapter({
        appId: null,
        clientSecret: null,
        redirectUri: null,
      }).authorizeUrl('x'),
    ).toThrow(ChannelUnavailableError)
  })

  it('canjea el código y calcula el vencimiento', async () => {
    global.fetch = respond(200, {
      access_token: 'A',
      refresh_token: 'R',
      expires_in: 100,
    })
    const adapter = new MercadoLibreListingAdapter(SETTINGS)
    const result = await adapter.exchangeCode('code')
    expect(result).toMatchObject({ accessToken: 'A', refreshToken: 'R' })
    expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('publica con el precio numérico, la moneda y las fotos por URL', async () => {
    const fetchMock = respond(201, { id: 'MLA1', permalink: 'https://ml/MLA1' })
    global.fetch = fetchMock
    const result = await new MercadoLibreListingAdapter(SETTINGS).publish(
      TOKENS,
      LISTING,
    )
    expect(result).toEqual({
      externalId: 'MLA1',
      externalUrl: 'https://ml/MLA1',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadolibre.com/items')
    expect(init.headers.Authorization).toBe('Bearer at')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      price: 150000,
      currency_id: 'ARS',
      pictures: [{ source: 'https://x/1.jpg' }],
    })
    expect(body.category_id).toEqual(expect.any(String))
  })

  it('un tipo de propiedad desconocido cae en la categoría por defecto', async () => {
    const fetchMock = respond(201, { id: 'MLA2' })
    global.fetch = fetchMock
    await new MercadoLibreListingAdapter(SETTINGS).publish(TOKENS, {
      ...LISTING,
      propertyType: 'Galpón raro',
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).category_id).toBe(
      ML_DEFAULT_RENTAL_CATEGORY,
    )
  })

  it('traduce los errores del portal a los tipados del puerto', async () => {
    const adapter = new MercadoLibreListingAdapter(SETTINGS)

    global.fetch = respond(401, { message: 'invalid_token' })
    await expect(adapter.publish(TOKENS, LISTING)).rejects.toBeInstanceOf(
      TokenExpiredError,
    )

    global.fetch = respond(400, {
      cause: [{ message: 'Falta el atributo ROOMS' }],
    })
    await expect(adapter.publish(TOKENS, LISTING)).rejects.toMatchObject({
      reasons: ['Falta el atributo ROOMS'],
    })
    await expect(adapter.publish(TOKENS, LISTING)).rejects.toBeInstanceOf(
      ListingRejectedError,
    )

    global.fetch = respond(503, {})
    await expect(adapter.publish(TOKENS, LISTING)).rejects.toBeInstanceOf(
      ChannelUnavailableError,
    )

    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'))
    await expect(adapter.publish(TOKENS, LISTING)).rejects.toBeInstanceOf(
      ChannelUnavailableError,
    )
  })

  it('un refresh rechazado obliga a reconectar', async () => {
    global.fetch = respond(400, { error: 'invalid_grant' })
    await expect(
      new MercadoLibreListingAdapter(SETTINGS).refresh(TOKENS),
    ).rejects.toBeInstanceOf(TokenExpiredError)
  })

  it('mapea las preguntas recibidas a consultas sin contacto', async () => {
    global.fetch = respond(200, {
      questions: [
        {
          id: 9,
          text: '¿Aceptan mascotas?',
          date_created: '2026-11-05T10:00:00Z',
          item_id: 'MLA1',
          from: { id: 55 },
        },
      ],
    })
    const items = await new MercadoLibreListingAdapter(SETTINGS).fetchInquiries(
      TOKENS,
      new Date('2026-11-01T00:00:00Z'),
    )
    expect(items).toEqual([
      expect.objectContaining({
        externalId: '9',
        externalListingId: 'MLA1',
        email: null,
        phone: null,
        message: '¿Aceptan mascotas?',
      }),
    ])
  })
})
