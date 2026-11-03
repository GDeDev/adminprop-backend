import { HttpImageDownloader } from './http-image-downloader'
import { TokkoFixtureSource } from './tokko-fixture.source'
import { TokkoHttpSource } from './tokko-http.source'
import { mapTokkoProperty } from './tokko-mapper'
import { TokkoProperty, TokkoSourceError } from '../tokko-source.port'
import { ImageDownloadError } from '../image-downloader.port'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

async function collect(source: AsyncIterable<TokkoProperty[]>) {
  const all: TokkoProperty[] = []
  for await (const page of source) all.push(...page)
  return all
}

describe('mapTokkoProperty', () => {
  it('toma la foto original, deja la portada primero y los montos como texto', () => {
    const property = mapTokkoProperty({
      id: 7,
      address: ' Av. Siempreviva 742 ',
      fake_address: 'Av. Siempreviva al 700',
      type: { name: 'Casa' },
      location: { full_location: 'Argentina | Buenos Aires | La Plata' },
      operations: [
        {
          operation_type: 'Rent',
          prices: [{ price: 450000.5, currency: 'ARS' }],
        },
      ],
      tags: [{ name: 'Pileta' }],
      photos: [
        { image: 'thumb2', original: 'orig2', order: 2 },
        { image: 'thumb0', original: 'orig0', order: 0, is_front_cover: true },
        { image: 'solo-thumb', order: 1 },
      ],
    })

    expect(property).toMatchObject({
      id: '7',
      address: 'Av. Siempreviva 742',
      typeName: 'Casa',
      fullLocation: 'Argentina | Buenos Aires | La Plata',
      tags: ['Pileta'],
      operations: [
        { type: 'Rent', prices: [{ currency: 'ARS', price: '450000.5' }] },
      ],
    })
    expect(property?.photos.map((p) => p.url)).toEqual([
      'orig0',
      'solo-thumb',
      'orig2',
    ])
  })

  it('descarta lo que no tiene id y no se rompe con campos faltantes', () => {
    expect(mapTokkoProperty(null)).toBeNull()
    expect(mapTokkoProperty({ address: 'sin id' })).toBeNull()
    expect(mapTokkoProperty({ id: 1 })).toMatchObject({
      address: null,
      typeName: null,
      operations: [],
      photos: [],
    })
  })
})

describe('TokkoFixtureSource', () => {
  it('sirve la muestra mapeada, con sus casos borde', async () => {
    const properties = await collect(new TokkoFixtureSource().properties())

    expect(properties).toHaveLength(6)
    expect(properties.find((p) => p.id === '90003')).toMatchObject({
      address: null,
      fakeAddress: 'Av. Rivadavia al 5100',
    })
    expect(properties.find((p) => p.id === '90004')?.fullLocation).toBeNull()
    expect(
      (await new TokkoFixtureSource().dictionaries()).propertyTypes,
    ).not.toHaveLength(0)
  })
})

describe('TokkoHttpSource', () => {
  const sleep = jest.fn().mockResolvedValue(undefined)
  const source = (fetchImpl: jest.Mock, apiKey: string | null = 'secreta') =>
    new TokkoHttpSource(apiKey, {
      fetchImpl,
      sleep,
      pauseMs: 0,
      retryBaseMs: 1,
    })

  it('pagina hasta que la API devuelve una página vacía', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json({ objects: [{ id: 1 }, { id: 2 }] }))
      .mockResolvedValueOnce(json({ objects: [{ id: 3 }] }))
      .mockResolvedValueOnce(json({ objects: [] }))

    const properties = await collect(source(fetchImpl).properties())

    expect(properties.map((p) => p.id)).toEqual(['1', '2', '3'])
    const urls = fetchImpl.mock.calls.map(([url]) => String(url))
    expect(urls[0]).toContain('offset=0')
    expect(urls[1]).toContain('offset=2')
    expect(urls[0]).toContain('key=secreta')
  })

  it('reintenta ante 429/5xx y termina bien', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({ objects: [] }))

    await expect(collect(source(fetchImpl).properties())).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('con una key inválida falla con un mensaje claro y sin la key', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({}, 401))

    const error = await source(fetchImpl)
      .dictionaries()
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TokkoSourceError)
    expect((error as Error).message).toBe(
      'Tokko respondió 401: revisá la API key',
    )
    expect((error as Error).message).not.toContain('secreta')
  })

  it('un error de red no filtra la URL (que lleva la key)', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValue(new Error('fetch failed https://x?key=secreta'))

    const error = await source(fetchImpl)
      .locationsSummary()
      .catch((e: unknown) => e)

    expect((error as Error).message).not.toContain('secreta')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('sin API key avisa antes de llamar a la red', async () => {
    const fetchImpl = jest.fn()
    await expect(source(fetchImpl, null).dictionaries()).rejects.toThrow(
      'TOKKO_API_KEY',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('HttpImageDownloader', () => {
  const sleep = jest.fn().mockResolvedValue(undefined)
  const image = (type = 'image/jpeg', bytes = 10, status = 200) =>
    new Response(Buffer.alloc(bytes, 1), {
      status,
      headers: { 'content-type': type },
    })
  const downloader = (fetchImpl: jest.Mock) =>
    new HttpImageDownloader({ fetchImpl, sleep })

  it('baja una imagen permitida', async () => {
    const result = await downloader(
      jest.fn().mockResolvedValue(image('image/webp')),
    ).download('https://cdn.example.com/a.webp')
    expect(result.mimeType).toBe('image/webp')
    expect(result.buffer).toHaveLength(10)
  })

  it('rechaza lo que no es jpg/png/webp, lo que pesa de más y los 404 sin reintentar', async () => {
    const notImage = jest.fn().mockResolvedValue(image('text/html'))
    await expect(
      downloader(notImage).download('https://cdn.example.com/a'),
    ).rejects.toThrow('no es una imagen')
    expect(notImage).toHaveBeenCalledTimes(1)

    await expect(
      downloader(
        jest.fn().mockResolvedValue(image('image/png', 10 * 1024 * 1024 + 1)),
      ).download('https://cdn.example.com/a'),
    ).rejects.toThrow('más de 10 MB')

    const missing = jest.fn().mockResolvedValue(image('image/png', 1, 404))
    await expect(
      downloader(missing).download('https://cdn.example.com/a'),
    ).rejects.toThrow('no existe')
    expect(missing).toHaveBeenCalledTimes(1)
  })

  it('reintenta dos veces ante un timeout y después falla', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('timeout'))
    await expect(
      downloader(fetchImpl).download('https://cdn.example.com/a'),
    ).rejects.toBeInstanceOf(ImageDownloadError)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('no sigue URLs internas ni de otros protocolos', async () => {
    const fetchImpl = jest.fn()
    for (const url of [
      'http://localhost/a.jpg',
      'http://169.254.169.254/latest',
      'http://10.0.0.5/a.jpg',
      'file:///etc/passwd',
      'no es url',
    ]) {
      await expect(downloader(fetchImpl).download(url)).rejects.toBeInstanceOf(
        ImageDownloadError,
      )
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
