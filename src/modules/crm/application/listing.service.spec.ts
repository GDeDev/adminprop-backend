import { PropertyStatus } from '@/modules/properties/public'
import { RequestContext } from '@/shared/context/request-context'
import { AppException } from '@/shared/errors'
import {
  ChannelNotConnectedException,
  ListingStateInvalidException,
} from '../domain/crm.exceptions'
import {
  ChannelState,
  ListingChannel,
  ListingChannelAccountData,
  ListingStatus,
  PropertyListingData,
} from '../domain/listing'
import { FakeListingPublisher } from '../infrastructure/publishers/fake-listing-publisher'
import { ConfiguredListingPublisherRegistry } from '../infrastructure/publishers/listing-publisher.registry'
import { ListingService } from './listing.service'
import { OAuthStateSigner } from './oauth-state'

const CH = ListingChannel.MERCADOLIBRE

const READY: {
  price: string | null
  [key: string]: unknown
} = {
  id: 'p1',
  title: 'Calle 1',
  address: 'Calle 1',
  location: 'Tolosa, La Plata',
  neighborhood: 'Tolosa',
  propertyType: 'Casa',
  status: PropertyStatus.AVAILABLE,
  price: '150000.00',
  currency: 'ARS',
  description: 'Linda casa',
  photoUrls: ['https://x/1.jpg'],
  amenities: ['Patio'],
  updatedAt: new Date(),
}

function build(info: Partial<typeof READY> | null = {}) {
  const fake = new FakeListingPublisher()
  const accounts = new Map<ListingChannel, ListingChannelAccountData>()
  const rows = new Map<string, PropertyListingData>()
  const key = (propertyId: string, channel: ListingChannel) =>
    `${propertyId}|${channel}`

  const channels = {
    find: jest.fn(async (c: ListingChannel) => accounts.get(c) ?? null),
    list: jest.fn(async () => [...accounts.values()]),
    listConnected: jest.fn(async () =>
      [...accounts.values()].filter((a) => a.status === ChannelState.CONNECTED),
    ),
    save: jest.fn(async (c: ListingChannel, patch: Record<string, unknown>) => {
      const current = accounts.get(c) ?? {
        id: 'a1',
        channel: c,
        status: ChannelState.DISCONNECTED,
        accountLabel: null,
        tokens: null,
        connectedAt: null,
        lastError: null,
        lastInquirySyncAt: null,
      }
      const next = { ...current, ...patch } as ListingChannelAccountData
      accounts.set(c, next)
      return next
    }),
  }
  const listings = {
    find: jest.fn(
      async (p: string, c: ListingChannel) => rows.get(key(p, c)) ?? null,
    ),
    findByExternalId: jest.fn(
      async (c: ListingChannel, id: string) =>
        [...rows.values()].find(
          (r) => r.channel === c && r.externalId === id,
        ) ?? null,
    ),
    listForProperty: jest.fn(async (p: string) =>
      [...rows.values()].filter((r) => r.propertyId === p),
    ),
    listActiveForProperty: jest.fn(async (p: string) =>
      [...rows.values()].filter(
        (r) =>
          r.propertyId === p &&
          [ListingStatus.PUBLISHED, ListingStatus.PAUSED].includes(r.status),
      ),
    ),
    upsert: jest.fn(
      async (
        p: string,
        c: ListingChannel,
        patch: Partial<PropertyListingData>,
      ) => {
        const current = rows.get(key(p, c)) ?? {
          id: 'l1',
          propertyId: p,
          channel: c,
          externalId: null,
          externalUrl: null,
          status: ListingStatus.NOT_PUBLISHED,
          payloadHash: null,
          publishedAt: null,
          lastSyncedAt: null,
          lastError: null,
        }
        const next = { ...current, ...patch }
        rows.set(key(p, c), next)
        return next
      },
    ),
  }
  const properties = {
    getForListing: jest.fn(async () =>
      info === null ? null : { ...READY, ...info },
    ),
  }
  const jobs = {
    start: jest.fn().mockResolvedValue('job-1'),
    markProcessing: jest.fn(),
    recordItem: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
  }
  const queue = { publish: jest.fn().mockResolvedValue('q1') }
  const notifications = { notifyStaff: jest.fn().mockResolvedValue('SENT') }
  const registrar = {
    register: jest.fn(async (input: { externalId: string; name: string }) => ({
      inquiry: { id: `i-${input.externalId}`, name: input.name },
      created: true,
    })),
  }
  const config = { get: jest.fn().mockReturnValue({ backofficeBaseUrl: null }) }
  const used = new Set<string>()
  const nonces = {
    claimOnce: jest.fn(async (_scope: string, key: string) => {
      if (used.has(key)) return false
      used.add(key)
      return true
    }),
  }

  const service = new ListingService(
    channels as never,
    listings as never,
    new ConfiguredListingPublisherRegistry({ [CH]: fake }),
    properties as never,
    jobs as never,
    queue as never,
    notifications as never,
    new OAuthStateSigner('secreto'),
    registrar as never,
    config as never,
    nonces as never,
  )
  const run = <T>(fn: () => Promise<T>) =>
    RequestContext.run(
      { correlationId: 'c1', tenantId: 't1', userId: 'u1' },
      fn,
    )

  const connect = async () => {
    const { accessToken, refreshToken, expiresAt } =
      await fake.exchangeCode('fake-code')
    await channels.save(CH, {
      status: ChannelState.CONNECTED,
      tokens: { accessToken, refreshToken, expiresAt },
    })
  }
  return {
    service,
    fake,
    channels,
    listings,
    jobs,
    queue,
    notifications,
    registrar,
    rows,
    run,
    connect,
    properties,
  }
}

describe('ListingService.enqueuePublish', () => {
  it('una propiedad no lista da LISTING_NOT_READY con lo que falta, antes que el canal', async () => {
    const t = build({ price: null, photoUrls: [], description: ' ' })
    const error = await t
      .run(() => t.service.enqueuePublish('p1', CH, false))
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppException)
    expect((error as AppException).code).toBe('LISTING_NOT_READY')
    expect((error as AppException).details).toHaveLength(3)
    expect(t.queue.publish).not.toHaveBeenCalled()
  })

  it('una propiedad alquilada tampoco se publica', async () => {
    const t = build({ status: PropertyStatus.RENTED })
    await expect(
      t.run(() => t.service.enqueuePublish('p1', CH, false)),
    ).rejects.toMatchObject({ code: 'LISTING_NOT_READY' })
  })

  it('sin la cuenta conectada es CHANNEL_NOT_CONNECTED', async () => {
    const t = build()
    await expect(
      t.run(() => t.service.enqueuePublish('p1', CH, false)),
    ).rejects.toBeInstanceOf(ChannelNotConnectedException)
  })

  it('Zonaprop y Argenprop no están disponibles', async () => {
    const t = build()
    await expect(
      t.run(() =>
        t.service.enqueuePublish('p1', ListingChannel.ZONAPROP, false),
      ),
    ).rejects.toMatchObject({ code: 'CHANNEL_UNAVAILABLE' })
  })

  it('encola con un AsyncJob y deja la publicación en PUBLISHING', async () => {
    const t = build()
    await t.connect()
    const result = await t.run(() => t.service.enqueuePublish('p1', CH, false))
    expect(result).toEqual({ jobId: 'job-1' })
    expect(t.rows.get('p1|MERCADOLIBRE')?.status).toBe(ListingStatus.PUBLISHING)
    expect(t.queue.publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'crm-listing-publish' }),
      { jobId: 'job-1', propertyId: 'p1', channel: CH },
    )
  })

  it('reintentar sólo vale desde ERROR', async () => {
    const t = build()
    await t.connect()
    await expect(
      t.run(() => t.service.enqueuePublish('p1', CH, true)),
    ).rejects.toBeInstanceOf(ListingStateInvalidException)
  })
})

describe('ListingService.runPublish', () => {
  const payload = { jobId: 'job-1', propertyId: 'p1', channel: CH }

  it('publica, guarda el id y la URL del portal y cierra el job', async () => {
    const t = build()
    await t.connect()
    await t.run(() => t.service.runPublish(payload))
    const row = t.rows.get('p1|MERCADOLIBRE')
    expect(row).toMatchObject({
      status: ListingStatus.PUBLISHED,
      externalId: expect.stringMatching(/^FAKE-/),
      externalUrl: expect.stringContaining('https://fake.local/items/'),
      lastError: null,
    })
    expect(row?.payloadHash).toHaveLength(64)
    expect(t.jobs.complete).toHaveBeenCalled()
  })

  it('un rechazo del portal deja ERROR con los motivos', async () => {
    const t = build()
    await t.connect()
    t.fake.failNext('REJECTED')
    await t.run(() => t.service.runPublish(payload))
    const row = t.rows.get('p1|MERCADOLIBRE')
    expect(row?.status).toBe(ListingStatus.ERROR)
    expect(row?.lastError).toContain('La categoría no admite')
    expect(t.jobs.fail).toHaveBeenCalledWith('job-1', expect.any(String))
  })

  it('token vencido que no se renueva: canal en ERROR, publicación en ERROR, aviso al personal y reintento OK', async () => {
    const t = build()
    await t.connect()
    t.fake.failNext('TOKEN_EXPIRED')
    await t.run(() => t.service.runPublish(payload))

    expect(t.rows.get('p1|MERCADOLIBRE')?.status).toBe(ListingStatus.ERROR)
    expect((await t.channels.find(CH))?.status).toBe(ChannelState.ERROR)
    expect(t.notifications.notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LISTING_CHANNEL_ERROR' }),
    )

    // El admin reconecta y reintenta.
    await t.connect()
    await t.run(() => t.service.enqueuePublish('p1', CH, true))
    await t.run(() => t.service.runPublish(payload))
    expect(t.rows.get('p1|MERCADOLIBRE')).toMatchObject({
      status: ListingStatus.PUBLISHED,
      lastError: null,
    })
  })

  it('un token vencido que sí se renueva sigue de largo', async () => {
    const t = build()
    await t.connect()
    // Sólo falla la operación; el refresh anda.
    t.fake.failNext('TOKEN_REJECTED')
    await t.run(() => t.service.runPublish(payload))
    expect(t.rows.get('p1|MERCADOLIBRE')?.status).toBe(ListingStatus.PUBLISHED)
  })

  it('actualizar una publicada mantiene el estado y renueva el hash; si falla no la apaga', async () => {
    const t = build()
    await t.connect()
    await t.run(() => t.service.runPublish(payload))
    const first = t.rows.get('p1|MERCADOLIBRE')?.payloadHash
    await t.run(() => t.service.changeStatus('p1', CH, 'pause'))

    t.properties.getForListing.mockResolvedValue({
      ...READY,
      price: '160000.00',
    })
    await t.run(() => t.service.runPublish(payload))
    const updated = t.rows.get('p1|MERCADOLIBRE')
    expect(updated?.status).toBe(ListingStatus.PAUSED)
    expect(updated?.payloadHash).not.toBe(first)

    t.fake.failNext('REJECTED')
    await t.run(() => t.service.runPublish(payload))
    expect(t.rows.get('p1|MERCADOLIBRE')).toMatchObject({
      status: ListingStatus.PAUSED,
      lastError: expect.stringContaining('rechazó'),
    })
  })
})

describe('ListingService.listingsFor', () => {
  it('detecta cambios sin publicar comparando el hash', async () => {
    const t = build()
    await t.connect()
    await t.run(() =>
      t.service.runPublish({ jobId: 'j', propertyId: 'p1', channel: CH }),
    )

    const same = await t.run(() => t.service.listingsFor('p1'))
    expect(same.find((l) => l.channel === CH)).toMatchObject({
      status: ListingStatus.PUBLISHED,
      hasUnpublishedChanges: false,
      canPublish: true,
    })

    t.properties.getForListing.mockResolvedValue({
      ...READY,
      description: 'Nueva',
    })
    const changed = await t.run(() => t.service.listingsFor('p1'))
    expect(changed.find((l) => l.channel === CH)?.hasUnpublishedChanges).toBe(
      true,
    )
  })

  it('lista los tres canales y marca qué falta; sin conexión no se puede publicar', async () => {
    const t = build({ photoUrls: [] })
    const views = await t.run(() => t.service.listingsFor('p1'))
    expect(views.map((v) => v.channel)).toEqual([
      'MERCADOLIBRE',
      'ZONAPROP',
      'ARGENPROP',
    ])
    expect(views[0]).toMatchObject({
      status: ListingStatus.NOT_PUBLISHED,
      canPublish: false,
      missingForPublish: ['Falta al menos una foto'],
    })
  })

  it('una propiedad de otro tenant (inexistente para este) es PROPERTY_NOT_FOUND', async () => {
    const t = build(null)
    await expect(t.run(() => t.service.listingsFor('x'))).rejects.toMatchObject(
      {
        code: 'PROPERTY_NOT_FOUND',
      },
    )
  })
})

describe('ListingService.changeStatus / closeAllFor', () => {
  const payload = { jobId: 'j', propertyId: 'p1', channel: CH }

  it('pausa, reanuda y cierra; cerrada no admite más acciones', async () => {
    const t = build()
    await t.connect()
    await t.run(() => t.service.runPublish(payload))
    expect(
      (await t.run(() => t.service.changeStatus('p1', CH, 'pause'))).status,
    ).toBe(ListingStatus.PAUSED)
    expect(
      (await t.run(() => t.service.changeStatus('p1', CH, 'resume'))).status,
    ).toBe(ListingStatus.PUBLISHED)
    await t.run(() => t.service.changeStatus('p1', CH, 'close'))
    await expect(
      t.run(() => t.service.changeStatus('p1', CH, 'pause')),
    ).rejects.toBeInstanceOf(ListingStateInvalidException)
  })

  it('cierre automático al alquilarse: cierra las activas en el portal (A-87)', async () => {
    const t = build()
    await t.connect()
    await t.run(() => t.service.runPublish(payload))
    const externalId = t.rows.get('p1|MERCADOLIBRE')?.externalId as string

    await expect(
      t.run(() => t.service.closeAllFor({ propertyId: 'p1' })),
    ).resolves.toBe(1)
    expect(t.rows.get('p1|MERCADOLIBRE')?.status).toBe(ListingStatus.CLOSED)
    expect(t.fake.remote(externalId)?.status).toBe('CLOSED')
    await expect(
      t.run(() => t.service.closeAllFor({ propertyId: 'p1' })),
    ).resolves.toBe(0)
  })

  it('si el portal falla al cerrar queda ERROR con el motivo', async () => {
    const t = build()
    await t.connect()
    await t.run(() => t.service.runPublish(payload))
    t.fake.failNext('UNAVAILABLE')
    await t.run(() => t.service.closeAllFor({ propertyId: 'p1' }))
    expect(t.rows.get('p1|MERCADOLIBRE')).toMatchObject({
      status: ListingStatus.ERROR,
      lastError: expect.stringContaining('al alquilarse'),
    })
  })
})

describe('ListingService OAuth', () => {
  it('conectar y volver del portal guarda la cuenta; un state manipulado se rechaza', async () => {
    const t = build()
    const url = await t.run(async () => t.service.connect(CH))
    const state = new URL(`https://x${url.authorizeUrl}`).searchParams.get(
      'state',
    ) as string

    await expect(
      t.service.completeOAuth(CH, { code: 'fake-code', state: `${state}x` }),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' })
    expect(t.channels.save).not.toHaveBeenCalled()

    const redirect = await t.service.completeOAuth(CH, {
      code: 'fake-code',
      state,
    })
    expect(redirect).toBe('/configuracion/canales?connected=mercadolibre')
    expect(await t.run(() => t.channels.find(CH))).toMatchObject({
      status: ChannelState.CONNECTED,
      accountLabel: 'Cuenta de prueba (simulada)',
    })

    // Antes el mismo state servía 10 minutos: quien lo viera (log, Referer)
    // podía conectar su propia cuenta a esta inmobiliaria.
    await expect(
      t.service.completeOAuth(CH, { code: 'fake-code', state }),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' })
  })

  it('un código inválido vuelve con error y no conecta', async () => {
    const t = build()
    const { authorizeUrl } = await t.run(async () => t.service.connect(CH))
    const state = new URL(`https://x${authorizeUrl}`).searchParams.get(
      'state',
    ) as string
    const redirect = await t.service.completeOAuth(CH, { code: 'otro', state })
    expect(redirect).toContain('error=connect_failed')
    expect(t.channels.save).not.toHaveBeenCalled()
  })

  it('desconectar borra los tokens y los canales sin adapter salen UNAVAILABLE', async () => {
    const t = build()
    await t.connect()
    const channels = await t.run(() => t.service.disconnect(CH))
    expect((await t.channels.find(CH))?.tokens).toBeNull()
    expect(channels.map((c) => c.status)).toEqual([
      'DISCONNECTED',
      'UNAVAILABLE',
      'UNAVAILABLE',
    ])
    expect(channels[1].unavailableReason).toContain('acuerdo comercial')
  })
})

describe('ListingService.pullInquiries', () => {
  it('trae las consultas del portal, las asocia a la propiedad y no las duplica', async () => {
    const t = build()
    await t.connect()
    await t.run(() =>
      t.service.runPublish({ jobId: 'j', propertyId: 'p1', channel: CH }),
    )
    const externalId = t.rows.get('p1|MERCADOLIBRE')?.externalId as string
    t.fake.simulateInquiry({ externalId: 'q-1', externalListingId: externalId })

    const first = await t.run(() => t.service.pullInquiries())
    expect(first).toEqual({ channels: 1, fetched: 1, created: 1, failed: 0 })
    expect(t.registrar.register).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'MERCADOLIBRE',
        externalId: 'q-1',
        propertyId: 'p1',
      }),
    )
    expect(t.notifications.notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PUBLIC_INQUIRY' }),
    )
  })

  it('un portal que falla se cuenta como fallido sin frenar el resto', async () => {
    const t = build()
    await t.connect()
    t.fake.failNext('UNAVAILABLE')
    const summary = await t.run(() => t.service.pullInquiries())
    expect(summary).toEqual({ channels: 1, fetched: 0, created: 0, failed: 1 })
  })
})
