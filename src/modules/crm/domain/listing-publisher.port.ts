import {
  ChannelTokens,
  ExternalInquiry,
  ListingChannel,
  ListingPayload,
  RemoteStatus,
} from './listing'

/** El access token venció y no se pudo renovar. */
export class TokenExpiredError extends Error {
  constructor(message = 'El token del portal venció') {
    super(message)
    this.name = 'TokenExpiredError'
  }
}

/** El portal rechazó la publicación; `reasons` son los motivos legibles. */
export class ListingRejectedError extends Error {
  constructor(readonly reasons: string[]) {
    super(`El portal rechazó la publicación: ${reasons.join('; ')}`)
    this.name = 'ListingRejectedError'
  }
}

/** El portal no responde o devolvió un error de servidor. */
export class ChannelUnavailableError extends Error {
  constructor(message = 'El portal no está disponible') {
    super(message)
    this.name = 'ChannelUnavailableError'
  }
}

/**
 * Puerto de un portal de publicación (Fase 23, 6.1). Un adapter por canal;
 * el módulo sólo conoce esta clase. Si el access token está vencido, el
 * adapter lo refresca con `refresh` antes de operar; el caso de uso guarda los
 * tokens nuevos.
 */
export abstract class ListingPublisherPort {
  abstract readonly channel: ListingChannel

  abstract authorizeUrl(state: string): string

  abstract exchangeCode(
    code: string,
  ): Promise<ChannelTokens & { accountLabel: string | null }>

  abstract refresh(tokens: ChannelTokens): Promise<ChannelTokens>

  abstract publish(
    tokens: ChannelTokens,
    listing: ListingPayload,
  ): Promise<{ externalId: string; externalUrl: string }>

  abstract update(
    tokens: ChannelTokens,
    externalId: string,
    listing: ListingPayload,
  ): Promise<void>

  abstract setStatus(
    tokens: ChannelTokens,
    externalId: string,
    status: RemoteStatus,
  ): Promise<void>

  abstract fetchInquiries(
    tokens: ChannelTokens,
    since: Date,
  ): Promise<ExternalInquiry[]>
}

/** Resuelve el adapter de un canal, o null si el canal no tiene. */
export abstract class ListingPublisherRegistry {
  abstract forChannel(channel: ListingChannel): ListingPublisherPort | null
}
