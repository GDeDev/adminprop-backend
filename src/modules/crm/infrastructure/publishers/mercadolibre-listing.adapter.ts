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

export interface MercadoLibreSettings {
  appId: string | null
  clientSecret: string | null
  redirectUri: string | null
  /** Sitio de Mercado Libre; Argentina = MLA. */
  siteId?: string
}

const API = 'https://api.mercadolibre.com'
const AUTH = 'https://auth.mercadolibre.com.ar/authorization'
const TIMEOUT_MS = 15_000
const DEFAULT_EXPIRES_IN = 6 * 3600

/**
 * Categorías de ML para inmuebles en alquiler (Argentina), por tipo de
 * propiedad. **A-86: los ids están escritos contra la documentación y no se
 * pudieron probar sin una app y una cuenta de prueba.** Confirmar con
 * `GET /sites/MLA/categories` y `GET /categories/<id>/attributes` en la
 * primera corrida real; este mapa es el único lugar que cambia.
 */
export const ML_RENTAL_CATEGORIES: Record<string, string> = {
  departamento: 'MLA1473',
  casa: 'MLA1467',
  ph: 'MLA1473',
  local: 'MLA1494',
  oficina: 'MLA1496',
  terreno: 'MLA1493',
  cochera: 'MLA50278',
}
export const ML_DEFAULT_RENTAL_CATEGORY = 'MLA1473'

const STATUS: Record<RemoteStatus, string> = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  CLOSED: 'closed',
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  user_id?: number
}

/**
 * Adapter de Mercado Libre (`LISTING_PUBLISHER_PROVIDER=mercadolibre`):
 * OAuth 2.0 con código de autorización y refresh token, publicación de un
 * aviso de inmueble en alquiler con las fotos por URL, cambio de estado y
 * consulta de preguntas recibidas. Sin verificar contra el servicio real
 * (A-86); los errores del portal se traducen a los tipados del puerto.
 */
export class MercadoLibreListingAdapter extends ListingPublisherPort {
  readonly channel = ListingChannel.MERCADOLIBRE

  constructor(private readonly settings: MercadoLibreSettings) {
    super()
  }

  authorizeUrl(state: string): string {
    const { appId, redirectUri } = this.requireSettings()
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: appId,
      redirect_uri: redirectUri,
      state,
    })
    return `${AUTH}?${query.toString()}`
  }

  async exchangeCode(
    code: string,
  ): Promise<ChannelTokens & { accountLabel: string | null }> {
    const { appId, clientSecret, redirectUri } = this.requireSettings()
    const tokens = await this.requestToken({
      grant_type: 'authorization_code',
      client_id: appId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    })
    let accountLabel: string | null = null
    try {
      const me = await this.call<{ nickname?: string }>(
        'GET',
        '/users/me',
        tokens.accessToken,
      )
      accountLabel = me.nickname ?? null
    } catch {
      // El nombre de la cuenta es decorativo: no frena la conexión.
    }
    return { ...tokens, accountLabel }
  }

  async refresh(tokens: ChannelTokens): Promise<ChannelTokens> {
    const { appId, clientSecret } = this.requireSettings()
    if (!tokens.refreshToken) throw new TokenExpiredError()
    try {
      return await this.requestToken({
        grant_type: 'refresh_token',
        client_id: appId,
        client_secret: clientSecret,
        refresh_token: tokens.refreshToken,
      })
    } catch (error) {
      // Un refresh rechazado no se arregla solo: hay que reconectar.
      if (error instanceof ListingRejectedError) throw new TokenExpiredError()
      throw error
    }
  }

  async publish(
    tokens: ChannelTokens,
    listing: ListingPayload,
  ): Promise<{ externalId: string; externalUrl: string }> {
    const item = await this.call<{ id: string; permalink?: string }>(
      'POST',
      '/items',
      tokens.accessToken,
      {
        title: listing.title.slice(0, 60),
        category_id: this.categoryFor(listing.propertyType),
        price: Number(listing.price),
        currency_id: listing.currency,
        available_quantity: 1,
        buying_mode: 'classified',
        listing_type_id: 'silver',
        condition: 'not_specified',
        description: { plain_text: listing.description },
        pictures: listing.photoUrls.map((source) => ({ source })),
        location: {
          address_line: listing.address,
          neighborhood: listing.neighborhood
            ? { name: listing.neighborhood }
            : undefined,
        },
        attributes: [
          { id: 'OPERATION', value_name: 'Alquiler' },
          ...listing.amenities.map((name) => ({
            id: 'AMENITIES',
            value_name: name,
          })),
        ],
      },
    )
    return {
      externalId: item.id,
      externalUrl:
        item.permalink ?? `https://articulo.mercadolibre.com.ar/${item.id}`,
    }
  }

  async update(
    tokens: ChannelTokens,
    externalId: string,
    listing: ListingPayload,
  ): Promise<void> {
    await this.call('PUT', `/items/${externalId}`, tokens.accessToken, {
      price: Number(listing.price),
      pictures: listing.photoUrls.map((source) => ({ source })),
    })
    await this.call(
      'PUT',
      `/items/${externalId}/description?api_version=2`,
      tokens.accessToken,
      { plain_text: listing.description },
    )
  }

  async setStatus(
    tokens: ChannelTokens,
    externalId: string,
    status: RemoteStatus,
  ): Promise<void> {
    await this.call('PUT', `/items/${externalId}`, tokens.accessToken, {
      status: STATUS[status],
    })
  }

  async fetchInquiries(
    tokens: ChannelTokens,
    since: Date,
  ): Promise<ExternalInquiry[]> {
    const result = await this.call<{
      questions?: {
        id: number
        text: string
        date_created: string
        item_id: string
        from?: { id: number }
      }[]
    }>(
      'GET',
      '/my/received_questions/search?status=UNANSWERED&api_version=4',
      tokens.accessToken,
    )
    return (result.questions ?? [])
      .map((question) => ({
        externalId: String(question.id),
        name: `Usuario de Mercado Libre${question.from ? ` ${question.from.id}` : ''}`,
        // ML no entrega contacto en las preguntas: se contestan en el portal (A-153).
        email: null,
        phone: null,
        message: question.text,
        externalListingId: question.item_id,
        createdAt: new Date(question.date_created),
      }))
      .filter((inquiry) => inquiry.createdAt >= since)
  }

  // ------------------------------------------------------------- Internos

  private categoryFor(propertyType: string): string {
    const key = propertyType
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
    return ML_RENTAL_CATEGORIES[key] ?? ML_DEFAULT_RENTAL_CATEGORY
  }

  private requireSettings(): {
    appId: string
    clientSecret: string
    redirectUri: string
  } {
    const { appId, clientSecret, redirectUri } = this.settings
    if (!appId || !clientSecret || !redirectUri) {
      throw new ChannelUnavailableError(
        'Falta configurar MERCADOLIBRE_APP_ID, MERCADOLIBRE_CLIENT_SECRET y MERCADOLIBRE_REDIRECT_URI en el servidor',
      )
    }
    return { appId, clientSecret, redirectUri }
  }

  private async requestToken(
    form: Record<string, string>,
  ): Promise<ChannelTokens> {
    const body = await this.call<TokenResponse>(
      'POST',
      '/oauth/token',
      null,
      new URLSearchParams(form),
    )
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      expiresAt: new Date(
        Date.now() + (body.expires_in ?? DEFAULT_EXPIRES_IN) * 1000,
      ),
    }
  }

  /**
   * Una llamada a la API. 401 = token vencido; 400/403/422 = rechazo con los
   * motivos del portal; 5xx o sin red = portal caído.
   */
  private async call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    accessToken: string | null,
    body?: object,
  ): Promise<T> {
    const isForm = body instanceof URLSearchParams
    let response: Response
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(body
            ? {
                'Content-Type': isForm
                  ? 'application/x-www-form-urlencoded'
                  : 'application/json',
              }
            : {}),
        },
        body: body
          ? isForm
            ? body.toString()
            : JSON.stringify(body)
          : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new ChannelUnavailableError('Mercado Libre no responde')
    }

    if (response.ok) return (await response.json()) as T

    const detail = (await response.json().catch(() => ({}))) as {
      message?: string
      error?: string
      cause?: { message?: string; code?: string }[]
    }
    if (response.status === 401) throw new TokenExpiredError()
    if (response.status >= 500 || response.status === 429) {
      throw new ChannelUnavailableError(
        `Mercado Libre respondió ${response.status}`,
      )
    }
    const reasons = (detail.cause ?? [])
      .map((cause) => cause.message ?? cause.code)
      .filter((reason): reason is string => Boolean(reason))
    throw new ListingRejectedError(
      reasons.length > 0
        ? reasons
        : [detail.message ?? detail.error ?? `Rechazado (${response.status})`],
    )
  }
}
