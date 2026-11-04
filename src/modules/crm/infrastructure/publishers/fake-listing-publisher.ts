import {
  ChannelTokens,
  ExternalInquiry,
  ListingChannel,
  ListingPayload,
  RemoteStatus,
} from '../../domain/listing'
import {
  ChannelUnavailableError,
  ListingPublisherPort,
  ListingRejectedError,
  TokenExpiredError,
} from '../../domain/listing-publisher.port'

/** El único `code` que acepta el OAuth simulado. */
export const FAKE_OAUTH_CODE = 'fake-code'

export type FakeFailure =
  'TOKEN_EXPIRED' | 'TOKEN_REJECTED' | 'REJECTED' | 'UNAVAILABLE'

interface FakeItem {
  payload: ListingPayload
  status: RemoteStatus
}

/**
 * Portal simulado (`LISTING_PUBLISHER_PROVIDER=fake`, el default). Autoriza con
 * un código fijo, "publica" devolviendo un id y una URL ficticios y guarda el
 * estado en memoria. Sirve para correr el flujo entero sin cuentas externas y
 * para los tests, que programan fallos con `failNext` y consultas entrantes
 * con `simulateInquiry`.
 *
 * `failNext('TOKEN_REJECTED')` simula un token rechazado que se renueva bien.
 * `failNext('TOKEN_EXPIRED')` simula un vencimiento que no se puede renovar:
 * la próxima operación falla y el próximo `refresh` también.
 */
export class FakeListingPublisher extends ListingPublisherPort {
  readonly channel = ListingChannel.MERCADOLIBRE

  private readonly items = new Map<string, FakeItem>()
  private readonly failures: FakeFailure[] = []
  private refreshBroken = false
  private inbox: ExternalInquiry[] = []
  private sequence = 0

  constructor(private readonly redirectUri: string | null = null) {
    super()
  }

  // ----------------------------------------------------- Control para tests

  failNext(kind: FakeFailure): void {
    this.failures.push(kind)
    if (kind === 'TOKEN_EXPIRED') this.refreshBroken = true
  }

  simulateInquiry(
    inquiry: Partial<ExternalInquiry> & { externalId: string },
  ): void {
    this.inbox.push({
      name: 'Interesado de prueba',
      email: null,
      phone: null,
      message: 'Hola, ¿sigue disponible?',
      externalListingId: null,
      createdAt: new Date(),
      ...inquiry,
    })
  }

  /** Lo que "hay publicado" en el portal simulado. */
  remote(externalId: string): FakeItem | undefined {
    return this.items.get(externalId)
  }

  reset(): void {
    this.items.clear()
    this.failures.length = 0
    this.refreshBroken = false
    this.inbox = []
  }

  // -------------------------------------------------------------- Puerto

  authorizeUrl(state: string): string {
    // Vuelve solo al callback con el código fijo: el OAuth de punta a punta sin portal.
    const base =
      this.redirectUri ?? '/api/v1/crm/channels/mercadolibre/callback'
    return `${base}?code=${FAKE_OAUTH_CODE}&state=${encodeURIComponent(state)}`
  }

  async exchangeCode(
    code: string,
  ): Promise<ChannelTokens & { accountLabel: string | null }> {
    if (code !== FAKE_OAUTH_CODE) {
      throw new ListingRejectedError(['El código de autorización no es válido'])
    }
    return {
      ...this.newTokens(),
      accountLabel: 'Cuenta de prueba (simulada)',
    }
  }

  async refresh(tokens: ChannelTokens): Promise<ChannelTokens> {
    if (this.refreshBroken) {
      this.refreshBroken = false
      throw new TokenExpiredError('No se pudo renovar el acceso al portal')
    }
    if (!tokens.refreshToken) throw new TokenExpiredError()
    return this.newTokens()
  }

  async publish(
    _tokens: ChannelTokens,
    listing: ListingPayload,
  ): Promise<{ externalId: string; externalUrl: string }> {
    this.consumeFailure()
    this.sequence += 1
    const externalId = `FAKE-${this.sequence}`
    this.items.set(externalId, { payload: listing, status: 'ACTIVE' })
    return { externalId, externalUrl: `https://fake.local/items/${externalId}` }
  }

  async update(
    _tokens: ChannelTokens,
    externalId: string,
    listing: ListingPayload,
  ): Promise<void> {
    this.consumeFailure()
    const item = this.require(externalId)
    item.payload = listing
  }

  async setStatus(
    _tokens: ChannelTokens,
    externalId: string,
    status: RemoteStatus,
  ): Promise<void> {
    this.consumeFailure()
    this.require(externalId).status = status
  }

  async fetchInquiries(
    _tokens: ChannelTokens,
    since: Date,
  ): Promise<ExternalInquiry[]> {
    this.consumeFailure()
    return this.inbox.filter((inquiry) => inquiry.createdAt >= since)
  }

  // ------------------------------------------------------------- Internos

  private newTokens(): ChannelTokens {
    this.sequence += 1
    return {
      accessToken: `fake-access-${this.sequence}`,
      refreshToken: `fake-refresh-${this.sequence}`,
      expiresAt: new Date(Date.now() + 6 * 3_600_000),
    }
  }

  private require(externalId: string): FakeItem {
    const item = this.items.get(externalId)
    if (!item) throw new ListingRejectedError(['La publicación no existe'])
    return item
  }

  private consumeFailure(): void {
    const failure = this.failures.shift()
    // TOKEN_REJECTED: el portal rechaza el token pero el refresh anda.
    if (failure === 'TOKEN_EXPIRED' || failure === 'TOKEN_REJECTED') {
      throw new TokenExpiredError()
    }
    if (failure === 'REJECTED') {
      throw new ListingRejectedError([
        'La categoría no admite este tipo de propiedad',
        'Las fotos no cumplen el tamaño mínimo',
      ])
    }
    if (failure === 'UNAVAILABLE') throw new ChannelUnavailableError()
  }
}
