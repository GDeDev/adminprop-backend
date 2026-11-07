import { RequestContext } from '@/shared/context/request-context'
import { HttpImageDownloader, isInternalAddress } from './http-image-downloader'
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
    new TokkoHttpSource(
      apiKey,
      { fetchImpl, sleep, pauseMs: 0, retryBaseMs: 1 },
      'ten-dueno',
    )

  let currentTenant: string | undefined = 'ten-dueno'
  beforeEach(() => {
    currentTenant = 'ten-dueno'
    jest
      .spyOn(RequestContext, 'tenantId', 'get')
      .mockImplementation(() => currentTenant)
  })
  afterEach(() => jest.restoreAllMocks())

  // La key es de una sola cuenta de Tokko: antes cualquier inmobiliaria con
  // TOKKO_SOURCE=http importaba el stock de la dueña de la key (D-253).
  it('sólo la inmobiliaria dueña de la key puede leer', async () => {
    const fetchImpl = jest.fn()
    currentTenant = 'otra-inmobiliaria'
    expect(source(fetchImpl).isAvailableFor('otra-inmobiliaria')).toBe(false)
    expect(source(fetchImpl).isAvailableFor('ten-dueno')).toBe(true)
    await expect(source(fetchImpl).dictionaries()).rejects.toThrow(
      TokkoSourceError,
    )
    await expect(collect(source(fetchImpl).properties())).rejects.toThrow(
      'no está habilitada',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sin TOKKO_TENANT_ID no la puede usar nadie', () => {
    expect(new TokkoHttpSource('secreta').isAvailableFor('ten-dueno')).toBe(
      false,
    )
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

  // Qué fallaba: el recorrido sólo terminaba con una página vacía; si Tokko
  // ignora `offset` y repite siempre la misma página, no terminaba nunca.
  it('corta cuando la API repite la misma página en vez de avanzar', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementation(async () => json({ objects: [{ id: 1 }, { id: 2 }] }))

    const properties = await collect(source(fetchImpl).properties())

    expect(properties.map((p) => p.id)).toEqual(['1', '2'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('falla con un mensaje claro si pasa el tope de páginas', async () => {
    let id = 0
    const fetchImpl = jest
      .fn()
      .mockImplementation(async () => json({ objects: [{ id: (id += 1) }] }))

    await expect(collect(source(fetchImpl).properties())).rejects.toThrow(
      'Tokko devolvió más de 40000 propiedades',
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2000)
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
  const SIGNATURES: Record<string, Buffer> = {
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'image/webp': Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
    ]),
  }
  /** Una "imagen" con la firma real de su tipo y el resto de relleno. */
  const bodyOf = (type: string, bytes: number): Uint8Array<ArrayBuffer> => {
    const body = Buffer.alloc(bytes, 1)
    ;(SIGNATURES[type] ?? Buffer.alloc(0)).copy(body)
    const out = new Uint8Array(new ArrayBuffer(bytes))
    out.set(body)
    return out
  }
  const image = (type = 'image/jpeg', bytes = 16, status = 200) =>
    new Response(bodyOf(type, bytes), {
      status,
      headers: { 'content-type': type },
    })
  const publicDns = jest.fn().mockResolvedValue(['93.184.216.34'])
  const downloader = (fetchImpl: jest.Mock, resolveHost = publicDns) =>
    new HttpImageDownloader({ fetchImpl, sleep, resolveHost })

  it('baja una imagen permitida', async () => {
    const result = await downloader(
      jest.fn().mockResolvedValue(image('image/webp')),
    ).download('https://cdn.example.com/a.webp')
    expect(result.mimeType).toBe('image/webp')
    expect(result.buffer).toHaveLength(16)
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

  // Qué fallaba: el Content-Type lo manda el sitio remoto y nunca se miraban
  // los bytes: un HTML o un SVG declarado como image/jpeg se guardaba como foto.
  it('rechaza un archivo que dice ser imagen pero no lo es, y usa el tipo real', async () => {
    const html = new Response('<html><script>alert(1)</script></html>', {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })
    await expect(
      downloader(jest.fn().mockResolvedValue(html)).download(
        'https://cdn.example.com/a.jpg',
      ),
    ).rejects.toThrow('no es una imagen')

    const pngSaidJpeg = new Response(bodyOf('image/png', 32), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })
    const result = await downloader(
      jest.fn().mockResolvedValue(pngSaidJpeg),
    ).download('https://cdn.example.com/a.jpg')
    expect(result.mimeType).toBe('image/png')
  })

  it('corta la lectura al pasar los 10 MB aunque no haya content-length', async () => {
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(1024 * 1024))
        if (pulled > 200) controller.close()
      },
    })
    const response = new Response(endless, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
    await expect(
      downloader(jest.fn().mockResolvedValue(response)).download(
        'https://cdn.example.com/a.png',
      ),
    ).rejects.toThrow('más de 10 MB')
    // No bajó el flujo entero: se detuvo cerca del tope.
    expect(pulled).toBeLessThan(30)
  })

  // Qué fallaba: el host se validaba solo para la URL inicial y el fetch
  // seguía las redirecciones solo, así que un host público con un 302 hacia
  // la red interna salteaba el chequeo.
  it('no sigue una redirección hacia la red interna', async () => {
    const redirect = (location: string) =>
      new Response(null, { status: 302, headers: { location } })
    for (const target of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:6379/',
      'http://[::ffff:127.0.0.1]/a.png',
      'ftp://cdn.example.com/a.jpg',
    ]) {
      const fetchImpl = jest.fn().mockResolvedValueOnce(redirect(target))
      await expect(
        downloader(fetchImpl).download('https://cdn.example.com/a.jpg'),
      ).rejects.toThrow(/no es pública|no es válida/)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('sigue una redirección pública (y la revalida) hasta un tope', async () => {
    const hop = () =>
      new Response(null, {
        status: 301,
        headers: { location: 'https://cdn2.example.com/b.jpg' },
      })
    const ok = jest
      .fn()
      .mockResolvedValueOnce(hop())
      .mockResolvedValueOnce(image('image/jpeg'))
    const result = await downloader(ok).download('https://cdn.example.com/a')
    expect(result.mimeType).toBe('image/jpeg')
    expect(publicDns).toHaveBeenCalledWith('cdn2.example.com')

    const loop = jest.fn().mockImplementation(async () => hop())
    await expect(
      downloader(loop).download('https://cdn.example.com/a'),
    ).rejects.toThrow('demasiadas veces')
    expect(loop).toHaveBeenCalledTimes(4)
  })

  it('rechaza un nombre público que resuelve a una dirección interna', async () => {
    const fetchImpl = jest.fn()
    const rebinding = jest
      .fn()
      .mockResolvedValue(['93.184.216.34', '127.0.0.1'])
    await expect(
      downloader(fetchImpl, rebinding).download('https://evil.example.com/a'),
    ).rejects.toThrow('no es pública')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('isInternalAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.31.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::',
    '::1',
    '::ffff:7f00:1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'fe80::1',
    'fd12:3456::1',
    'ff02::1',
  ])('%s es interna', (address) => {
    expect(isInternalAddress(address)).toBe(true)
  })

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '172.32.0.1',
    '2606:2800:220:1:248:1893:25c8:1946',
    '::ffff:8.8.8.8',
  ])('%s es pública', (address) => {
    expect(isInternalAddress(address)).toBe(false)
  })
})
