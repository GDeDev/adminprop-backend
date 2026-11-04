import { HttpStatus, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { AsyncJobsFacade } from '@/modules/jobs/public'
import {
  PropertiesFacade,
  PropertyListingInfo,
  PropertyStatus,
} from '@/modules/properties/public'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { QueuePort } from '@/platform/queue/queue.port'
import { Configuration } from '@/shared/config/configuration'
import { RequestContext } from '@/shared/context/request-context'
import { errorMessage } from '@/shared/core/error-message'
import { todayIso } from '@/shared/dates/calendar-date'
import { AppException, ErrorCode } from '@/shared/errors'
import { createLogger } from '@/shared/logging/root-logger'
import {
  ChannelNotConnectedException,
  ChannelUnavailableForTenantException,
  CrmPropertyNotFoundException,
  ListingNotFoundException,
  ListingStateInvalidException,
  OAuthStateInvalidException,
} from '../domain/crm.exceptions'
import {
  ListingChannelRepository,
  PropertyListingRepository,
} from '../domain/crm.ports'
import { InquirySource } from '../domain/inquiry'
import {
  AVAILABLE_CHANNELS,
  canTransition,
  ChannelState,
  ChannelTokens,
  ListingChannel,
  ListingChannelAccountData,
  ListingPayload,
  ListingStatus,
  missingForPublish,
  payloadHash,
  PropertyListingData,
  RemoteStatus,
  UNAVAILABLE_REASONS,
} from '../domain/listing'
import {
  ChannelUnavailableError,
  ListingPublisherPort,
  ListingPublisherRegistry,
  ListingRejectedError,
  TokenExpiredError,
} from '../domain/listing-publisher.port'
import { InquiryRegistrar } from './inquiry-registrar'
import {
  LISTING_PUBLISH_JOB_TYPE,
  LISTING_PUBLISH_QUEUE,
  ListingClosePayload,
  ListingPublishPayload,
  LISTING_CLOSE_QUEUE,
} from './listing-queues'
import {
  ListingChannelView,
  PropertyListingView,
  PullSummary,
} from './listing.views'
import { OAuthStateSigner } from './oauth-state'

const REFRESH_MARGIN_MS = 60_000
const FIRST_PULL_DAYS = 7
const MAX_ERROR_LENGTH = 480
const ALL_CHANNELS = Object.values(ListingChannel)

const TOKEN_EXPIRED_MESSAGE =
  'La conexión con el portal venció. Reconectá la cuenta para seguir publicando.'

/**
 * Multipublicación (Fase 23, 6): canales conectados, publicaciones por
 * propiedad y consultas entrantes. Habla con el portal sólo por
 * `ListingPublisherPort`. Todo corre dentro del tenant del contexto (un
 * request o un worker de la cola).
 */
@Injectable()
export class ListingService {
  private readonly logger = createLogger('ListingService')

  constructor(
    private readonly channels: ListingChannelRepository,
    private readonly listings: PropertyListingRepository,
    private readonly registry: ListingPublisherRegistry,
    private readonly properties: PropertiesFacade,
    private readonly jobs: AsyncJobsFacade,
    private readonly queue: QueuePort,
    private readonly notifications: NotificationsService,
    private readonly signer: OAuthStateSigner,
    private readonly registrar: InquiryRegistrar,
    private readonly config: ConfigService<Configuration, true>,
  ) {}

  // ------------------------------------------------------------- Canales

  /** Los tres canales; Zonaprop y Argenprop salen `UNAVAILABLE` (6.1). */
  async listChannels(): Promise<ListingChannelView[]> {
    const accounts = new Map(
      (await this.channels.list()).map((a) => [a.channel, a]),
    )
    return ALL_CHANNELS.map((channel) => {
      if (!AVAILABLE_CHANNELS.includes(channel)) {
        return {
          channel,
          status: 'UNAVAILABLE',
          accountLabel: null,
          connectedAt: null,
          lastError: null,
          unavailableReason: UNAVAILABLE_REASONS[channel] ?? null,
        }
      }
      const account = accounts.get(channel)
      return {
        channel,
        status: account?.status ?? ChannelState.DISCONNECTED,
        accountLabel: account?.accountLabel ?? null,
        connectedAt: account?.connectedAt ?? null,
        lastError: account?.lastError ?? null,
        unavailableReason: null,
      }
    })
  }

  /** La URL del portal a la que hay que mandar al navegador, con el `state` firmado. */
  connect(channel: ListingChannel): { authorizeUrl: string } {
    const publisher = this.publisherFor(channel)
    const state = this.signer.sign({
      tenantId: RequestContext.tenantId as string,
      userId: RequestContext.userId as string,
      channel,
    })
    return { authorizeUrl: publisher.authorizeUrl(state) }
  }

  /**
   * Vuelta del portal (sin JWT): valida el `state`, canjea el código y guarda
   * los tokens cifrados. Devuelve a dónde redirigir al navegador. Un `state`
   * inválido tira `OAUTH_STATE_INVALID`; un canje fallido vuelve con `error`.
   */
  async completeOAuth(
    channel: ListingChannel,
    params: { code?: string; state: string; error?: string },
  ): Promise<string> {
    const state = this.signer.verify(params.state)
    // Un state de otro canal no vale acá: mismo error que uno manipulado.
    if (state.channel !== channel) throw new OAuthStateInvalidException()
    return RequestContext.runInTenant(state.tenantId, async () => {
      if (params.error || !params.code) {
        return this.backofficeUrl({ error: 'denied' })
      }
      try {
        const publisher = this.publisherFor(channel)
        const result = await publisher.exchangeCode(params.code)
        await this.channels.save(channel, {
          status: ChannelState.CONNECTED,
          accountLabel: result.accountLabel,
          tokens: {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt: result.expiresAt,
          },
          connectedById: state.userId,
          connectedAt: new Date(),
          lastError: null,
        })
        return this.backofficeUrl({ connected: channel.toLowerCase() })
      } catch (error) {
        this.logger.warn(
          { channel, err: errorMessage(error) },
          'No se pudo conectar la cuenta del portal',
        )
        return this.backofficeUrl({ error: 'connect_failed' })
      }
    })
  }

  /** Borra los tokens. Las publicaciones activas quedan en el portal (la UI lo avisa). */
  async disconnect(channel: ListingChannel): Promise<ListingChannelView[]> {
    this.publisherFor(channel)
    await this.channels.save(channel, {
      status: ChannelState.DISCONNECTED,
      accountLabel: null,
      tokens: null,
      connectedById: null,
      connectedAt: null,
      lastError: null,
    })
    return this.listChannels()
  }

  // ------------------------------------------------------- Publicaciones

  /** Un renglón por canal, publicado o no. */
  async listingsFor(propertyId: string): Promise<PropertyListingView[]> {
    const info = await this.requireProperty(propertyId)
    const [existing, accounts] = await Promise.all([
      this.listings.listForProperty(propertyId),
      this.channels.list(),
    ])
    const byChannel = new Map(existing.map((l) => [l.channel, l]))
    const connected = new Set(
      accounts
        .filter((a) => a.status === ChannelState.CONNECTED)
        .map((a) => a.channel),
    )
    return ALL_CHANNELS.map((channel) =>
      this.toView(
        info,
        channel,
        byChannel.get(channel),
        connected.has(channel),
      ),
    )
  }

  /**
   * Valida y encola la publicación (o la actualización, o el reintento).
   * 422 `LISTING_NOT_READY` antes que 409 `CHANNEL_NOT_CONNECTED`.
   */
  async enqueuePublish(
    propertyId: string,
    channel: ListingChannel,
    retry: boolean,
  ): Promise<{ jobId: string }> {
    this.publisherFor(channel)
    const info = await this.requireProperty(propertyId)

    const missing = this.missingFor(info)
    if (missing.length > 0) {
      throw new AppException(
        ErrorCode.LISTING_NOT_READY,
        'La propiedad todavía no está lista para publicarse',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { details: missing.map((message) => ({ message, field: 'missing' })) },
      )
    }
    const account = await this.channels.find(channel)
    if (account?.status !== ChannelState.CONNECTED || !account.tokens) {
      throw new ChannelNotConnectedException(channel)
    }

    const current = await this.listings.find(propertyId, channel)
    if (retry && current?.status !== ListingStatus.ERROR) {
      throw new ListingStateInvalidException(
        'retry',
        current?.status ?? 'NOT_PUBLISHED',
      )
    }
    if (current?.status === ListingStatus.PUBLISHING) {
      throw new ListingStateInvalidException('publish', current.status)
    }

    // Publicada o pausada = actualizar: el estado no cambia hasta que termine.
    const updating =
      current?.status === ListingStatus.PUBLISHED ||
      current?.status === ListingStatus.PAUSED
    if (!updating) {
      await this.listings.upsert(propertyId, channel, {
        status: ListingStatus.PUBLISHING,
        lastError: null,
        // Una cerrada no se reabre en el portal: se publica un aviso nuevo.
        ...(current?.status === ListingStatus.CLOSED
          ? { externalId: null, externalUrl: null }
          : {}),
      })
    }

    const jobId = await this.jobs.start(LISTING_PUBLISH_JOB_TYPE, {
      totalItems: 1,
    })
    const payload: ListingPublishPayload = { jobId, propertyId, channel }
    try {
      await this.queue.publish(LISTING_PUBLISH_QUEUE, payload)
    } catch (error) {
      await this.jobs.fail(jobId, errorMessage(error))
      if (!updating) {
        await this.listings.upsert(propertyId, channel, {
          status: current?.status ?? ListingStatus.NOT_PUBLISHED,
        })
      }
      throw error
    }
    return { jobId }
  }

  /** El trabajo de la cola: publica o actualiza y deja el resultado en la publicación. */
  async runPublish({
    jobId,
    propertyId,
    channel,
  }: ListingPublishPayload): Promise<void> {
    await this.jobs.markProcessing(jobId)
    const before = await this.listings.find(propertyId, channel)
    const updating = Boolean(before?.externalId)
    const keepStatus =
      before?.status === ListingStatus.PUBLISHED ||
      before?.status === ListingStatus.PAUSED
    try {
      const info = await this.requireProperty(propertyId)
      const missing = this.missingFor(info)
      if (missing.length > 0) throw new ListingRejectedError(missing)
      const account = await this.requireConnected(channel)
      const publisher = this.publisherFor(channel)
      const payload = this.toPayload(info)
      const now = new Date()

      if (updating && before?.externalId) {
        const externalId = before.externalId
        await this.withTokens(account, publisher, async (tokens) => {
          await publisher.update(tokens, externalId, payload)
          // Un reintento de una publicación en error la deja activa en el portal.
          if (!keepStatus)
            await publisher.setStatus(tokens, externalId, 'ACTIVE')
        })
        await this.listings.upsert(propertyId, channel, {
          status: keepStatus ? before.status : ListingStatus.PUBLISHED,
          payloadHash: payloadHash(payload),
          lastSyncedAt: now,
          lastError: null,
        })
        await this.jobs.recordItem(jobId, 'succeeded')
        await this.jobs.complete(jobId, { externalUrl: before.externalUrl })
        return
      }

      const result = await this.withTokens(account, publisher, (tokens) =>
        publisher.publish(tokens, payload),
      )
      await this.listings.upsert(propertyId, channel, {
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        status: ListingStatus.PUBLISHED,
        payloadHash: payloadHash(payload),
        publishedAt: now,
        lastSyncedAt: now,
        lastError: null,
      })
      await this.jobs.recordItem(jobId, 'succeeded')
      await this.jobs.complete(jobId, { externalUrl: result.externalUrl })
    } catch (error) {
      const message = await this.describeFailure(error, channel)
      // Una actualización fallida no apaga un aviso que sigue vivo en el portal.
      await this.listings.upsert(propertyId, channel, {
        status: keepStatus ? before?.status : ListingStatus.ERROR,
        lastError: message,
      })
      await this.jobs.recordItem(jobId, 'failed')
      await this.jobs.fail(jobId, message)
    }
  }

  /** Pausar, reanudar o cerrar: se aplica en el portal en el momento. */
  async changeStatus(
    propertyId: string,
    channel: ListingChannel,
    action: 'pause' | 'resume' | 'close',
  ): Promise<PropertyListingView> {
    this.publisherFor(channel)
    const info = await this.requireProperty(propertyId)
    const listing = await this.listings.find(propertyId, channel)
    if (!listing?.externalId)
      throw new ListingNotFoundException(propertyId, channel)
    if (!canTransition(action, listing.status)) {
      throw new ListingStateInvalidException(action, listing.status)
    }
    const account = await this.requireConnected(channel)
    const publisher = this.publisherFor(channel)
    const externalId = listing.externalId
    const remote: Record<typeof action, RemoteStatus> = {
      pause: 'PAUSED',
      resume: 'ACTIVE',
      close: 'CLOSED',
    }
    const next: Record<typeof action, ListingStatus> = {
      pause: ListingStatus.PAUSED,
      resume: ListingStatus.PUBLISHED,
      close: ListingStatus.CLOSED,
    }
    try {
      await this.withTokens(account, publisher, (tokens) =>
        publisher.setStatus(tokens, externalId, remote[action]),
      )
    } catch (error) {
      const message = await this.describeFailure(error, channel)
      await this.listings.upsert(propertyId, channel, { lastError: message })
      throw this.toHttpError(error, message)
    }
    const updated = await this.listings.upsert(propertyId, channel, {
      status: next[action],
      lastSyncedAt: new Date(),
      lastError: null,
    })
    return this.toView(info, channel, updated, true)
  }

  /** Cierra en el portal las publicaciones activas de una propiedad que se alquiló (A-87). */
  async closeAllFor({ propertyId }: ListingClosePayload): Promise<number> {
    const active = await this.listings.listActiveForProperty(propertyId)
    let closed = 0
    for (const listing of active) {
      try {
        const account = await this.requireConnected(listing.channel)
        const publisher = this.publisherFor(listing.channel)
        const externalId = listing.externalId as string
        await this.withTokens(account, publisher, (tokens) =>
          publisher.setStatus(tokens, externalId, 'CLOSED'),
        )
        await this.listings.upsert(propertyId, listing.channel, {
          status: ListingStatus.CLOSED,
          lastSyncedAt: new Date(),
          lastError: null,
        })
        closed += 1
      } catch (error) {
        const message = await this.describeFailure(error, listing.channel)
        await this.listings.upsert(propertyId, listing.channel, {
          status: ListingStatus.ERROR,
          lastError: `No se pudo cerrar al alquilarse: ${message}`.slice(
            0,
            MAX_ERROR_LENGTH,
          ),
        })
      }
    }
    return closed
  }

  /** Encola el cierre automático; un fallo de la cola no tumba el alquiler. */
  async scheduleCloseFor(propertyId: string): Promise<void> {
    try {
      if ((await this.listings.listActiveForProperty(propertyId)).length === 0)
        return
      await this.queue.publish<ListingClosePayload>(LISTING_CLOSE_QUEUE, {
        propertyId,
      })
    } catch (error) {
      this.logger.error(
        { err: error, propertyId },
        'No se pudo encolar el cierre de publicaciones',
      )
    }
  }

  // ------------------------------------------------- Consultas entrantes

  /** Trae las consultas de los portales conectados del tenant (job de cada tanda). */
  async pullInquiries(): Promise<PullSummary> {
    const summary: PullSummary = {
      channels: 0,
      fetched: 0,
      created: 0,
      failed: 0,
    }
    for (const account of await this.channels.listConnected()) {
      const publisher = this.registry.forChannel(account.channel)
      if (!publisher || !account.tokens) continue
      summary.channels += 1
      const startedAt = new Date()
      const since =
        account.lastInquirySyncAt ??
        new Date(startedAt.getTime() - FIRST_PULL_DAYS * 86_400_000)
      try {
        const incoming = await this.withTokens(account, publisher, (tokens) =>
          publisher.fetchInquiries(tokens, since),
        )
        summary.fetched += incoming.length
        for (const item of incoming) {
          const listing = item.externalListingId
            ? await this.listings.findByExternalId(
                account.channel,
                item.externalListingId,
              )
            : null
          const { inquiry, created } = await this.registrar.register({
            name: item.name,
            email: item.email,
            phone: item.phone,
            message: item.message,
            propertyId: listing?.propertyId ?? null,
            source: sourceOf(account.channel),
            externalId: item.externalId,
            createdAt: item.createdAt,
          })
          if (created) {
            summary.created += 1
            await this.notifyInbound(inquiry.id, inquiry.name, account.channel)
          }
        }
        await this.channels.save(account.channel, {
          lastInquirySyncAt: startedAt,
        })
      } catch (error) {
        summary.failed += 1
        await this.describeFailure(error, account.channel)
      }
    }
    return summary
  }

  // ------------------------------------------------------------ Internos

  private publisherFor(channel: ListingChannel): ListingPublisherPort {
    const publisher = this.registry.forChannel(channel)
    if (!publisher || !AVAILABLE_CHANNELS.includes(channel)) {
      throw new ChannelUnavailableForTenantException(channel)
    }
    return publisher
  }

  private async requireProperty(
    propertyId: string,
  ): Promise<PropertyListingInfo> {
    const info = await this.properties.getForListing(propertyId)
    if (!info) throw new CrmPropertyNotFoundException(propertyId)
    return info
  }

  private async requireConnected(
    channel: ListingChannel,
  ): Promise<ListingChannelAccountData> {
    const account = await this.channels.find(channel)
    if (account?.status !== ChannelState.CONNECTED || !account.tokens) {
      throw new ChannelNotConnectedException(channel)
    }
    return account
  }

  private missingFor(info: PropertyListingInfo): string[] {
    return missingForPublish({
      available: info.status === PropertyStatus.AVAILABLE,
      price: info.price,
      photoCount: info.photoUrls.length,
      description: info.description,
    })
  }

  private toPayload(info: PropertyListingInfo): ListingPayload {
    return {
      propertyId: info.id,
      title: `${info.propertyType} en alquiler en ${info.title}`.slice(0, 60),
      address: info.address,
      location: info.location,
      neighborhood: info.neighborhood,
      propertyType: info.propertyType,
      price: info.price as string,
      currency: info.currency,
      description: info.description as string,
      photoUrls: info.photoUrls,
      amenities: info.amenities,
    }
  }

  private toView(
    info: PropertyListingInfo,
    channel: ListingChannel,
    listing: PropertyListingData | undefined,
    connected: boolean,
  ): PropertyListingView {
    const missing = this.missingFor(info)
    const live =
      listing?.status === ListingStatus.PUBLISHED ||
      listing?.status === ListingStatus.PAUSED
    return {
      channel,
      status: listing?.status ?? ListingStatus.NOT_PUBLISHED,
      externalUrl: listing?.externalUrl ?? null,
      publishedAt: listing?.publishedAt ?? null,
      lastSyncedAt: listing?.lastSyncedAt ?? null,
      lastError: listing?.lastError ?? null,
      // Sólo se puede comparar si la ficha todavía arma un aviso válido.
      hasUnpublishedChanges:
        live && missing.length === 0
          ? listing?.payloadHash !== payloadHash(this.toPayload(info))
          : false,
      canPublish:
        AVAILABLE_CHANNELS.includes(channel) &&
        connected &&
        missing.length === 0,
      missingForPublish: missing,
    }
  }

  /**
   * Corre una operación con el access token vigente: lo renueva antes si está
   * por vencer, y una vez más si el portal lo rechaza. Si no se puede renovar,
   * el canal pasa a `ERROR`.
   */
  private async withTokens<T>(
    account: ListingChannelAccountData,
    publisher: ListingPublisherPort,
    operation: (tokens: ChannelTokens) => Promise<T>,
  ): Promise<T> {
    let tokens = account.tokens as ChannelTokens
    if (
      tokens.expiresAt &&
      tokens.expiresAt.getTime() - REFRESH_MARGIN_MS <= Date.now()
    ) {
      tokens = await this.renew(account, publisher, tokens)
    }
    try {
      return await operation(tokens)
    } catch (error) {
      if (!(error instanceof TokenExpiredError)) throw error
      tokens = await this.renew(account, publisher, tokens)
      return operation(tokens)
    }
  }

  private async renew(
    account: ListingChannelAccountData,
    publisher: ListingPublisherPort,
    tokens: ChannelTokens,
  ): Promise<ChannelTokens> {
    const fresh = await publisher.refresh(tokens)
    await this.channels.save(account.channel, {
      tokens: fresh,
      status: ChannelState.CONNECTED,
      lastError: null,
    })
    return fresh
  }

  /**
   * Traduce el error del portal a un texto para la ficha. Un token que no se
   * puede renovar deja el canal en `ERROR` y avisa al personal.
   */
  private async describeFailure(
    error: unknown,
    channel: ListingChannel,
  ): Promise<string> {
    let message: string
    if (error instanceof TokenExpiredError) {
      message = TOKEN_EXPIRED_MESSAGE
      await this.channels.save(channel, {
        status: ChannelState.ERROR,
        lastError: message,
      })
      await this.notifyChannelError(channel, message)
    } else if (error instanceof ListingRejectedError) {
      message = `El portal rechazó la publicación: ${error.reasons.join('; ')}`
    } else if (error instanceof ChannelUnavailableError) {
      message = error.message
    } else if (error instanceof ChannelNotConnectedException) {
      message = 'La cuenta del portal no está conectada'
    } else {
      this.logger.error({ err: error, channel }, 'Falló una publicación')
      message = 'Error inesperado al hablar con el portal'
    }
    return message.slice(0, MAX_ERROR_LENGTH)
  }

  private toHttpError(error: unknown, message: string): Error {
    if (error instanceof TokenExpiredError) {
      return AppException.conflict(message, ErrorCode.CONFLICT)
    }
    if (error instanceof ListingRejectedError) {
      return AppException.unprocessable(message)
    }
    if (error instanceof ChannelNotConnectedException) return error
    return AppException.externalService('listing-portal', message)
  }

  private backofficeUrl(query: Record<string, string>): string {
    const base =
      this.config.get('listings', { infer: true }).backofficeBaseUrl ?? ''
    const search = new URLSearchParams(query).toString()
    return `${base.replace(/\/$/, '')}/configuracion/canales?${search}`
  }

  private async notifyChannelError(
    channel: ListingChannel,
    message: string,
  ): Promise<void> {
    try {
      await this.notifications.notifyStaff({
        tenantId: RequestContext.tenantId as string,
        type: 'LISTING_CHANNEL_ERROR',
        title: `Falló la conexión con ${channelLabel(channel)}`,
        body: message,
        dedupeKey: `LISTING_CHANNEL_ERROR:${channel}:${todayIso()}`,
        // Sin `entity`: `notification_log.entity_id` es un UUID y el canal se
        // identifica por su nombre (`MERCADOLIBRE`), así que guardarlo hacía
        // fallar el INSERT y el aviso nunca se creaba. El `dedupeKey` ya lo
        // distingue por canal y día.
        link: '/configuracion/canales',
      })
    } catch (error) {
      this.logger.error({ err: error }, 'No se pudo avisar la falla del portal')
    }
  }

  private async notifyInbound(
    inquiryId: string,
    name: string,
    channel: ListingChannel,
  ): Promise<void> {
    try {
      await this.notifications.notifyStaff({
        tenantId: RequestContext.tenantId as string,
        type: 'PUBLIC_INQUIRY',
        title: `Nueva consulta de ${name}`,
        body: `${name} escribió desde ${channelLabel(channel)}.`,
        dedupeKey: `PUBLIC_INQUIRY:${inquiryId}`,
        entity: { type: 'Inquiry', id: inquiryId },
        link: '/crm',
      })
    } catch (error) {
      this.logger.error(
        { err: error },
        'No se pudo avisar la consulta entrante',
      )
    }
  }
}

function channelLabel(channel: ListingChannel): string {
  return channel === ListingChannel.MERCADOLIBRE
    ? 'Mercado Libre'
    : channel === ListingChannel.ZONAPROP
      ? 'Zonaprop'
      : 'Argenprop'
}

function sourceOf(channel: ListingChannel): InquirySource {
  return channel === ListingChannel.MERCADOLIBRE
    ? InquirySource.MERCADOLIBRE
    : channel === ListingChannel.ZONAPROP
      ? InquirySource.ZONAPROP
      : InquirySource.ARGENPROP
}
