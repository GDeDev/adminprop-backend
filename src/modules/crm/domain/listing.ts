import { createHash } from 'node:crypto'

export enum ListingChannel {
  MERCADOLIBRE = 'MERCADOLIBRE',
  ZONAPROP = 'ZONAPROP',
  ARGENPROP = 'ARGENPROP',
}

/** Estado de la cuenta conectada; `UNAVAILABLE` sólo existe en el DTO. */
export enum ChannelState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export enum ListingStatus {
  NOT_PUBLISHED = 'NOT_PUBLISHED',
  PUBLISHING = 'PUBLISHING',
  PUBLISHED = 'PUBLISHED',
  PAUSED = 'PAUSED',
  ERROR = 'ERROR',
  CLOSED = 'CLOSED',
}

/** Canales con adapter; el resto se muestra como no disponible (6.1). */
export const AVAILABLE_CHANNELS: readonly ListingChannel[] = [
  ListingChannel.MERCADOLIBRE,
]

export const UNAVAILABLE_REASONS: Partial<Record<ListingChannel, string>> = {
  [ListingChannel.ZONAPROP]:
    'Zonaprop requiere un acuerdo comercial y un feed acordado; todavía no está disponible.',
  [ListingChannel.ARGENPROP]:
    'Argenprop requiere un acuerdo comercial y un feed acordado; todavía no está disponible.',
}

export type RemoteStatus = 'ACTIVE' | 'PAUSED' | 'CLOSED'

export interface ChannelTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}

export interface ListingChannelAccountData {
  id: string
  channel: ListingChannel
  status: ChannelState
  accountLabel: string | null
  /** Ya descifrados; nunca salen del backend. */
  tokens: ChannelTokens | null
  connectedAt: Date | null
  lastError: string | null
  lastInquirySyncAt: Date | null
}

export interface PropertyListingData {
  id: string
  propertyId: string
  channel: ListingChannel
  externalId: string | null
  externalUrl: string | null
  status: ListingStatus
  payloadHash: string | null
  publishedAt: Date | null
  lastSyncedAt: Date | null
  lastError: string | null
}

/** Lo que se manda al portal; el precio viaja como string (se convierte en el adapter). */
export interface ListingPayload {
  propertyId: string
  title: string
  address: string
  location: string
  neighborhood: string | null
  propertyType: string
  price: string
  currency: string
  description: string
  photoUrls: string[]
  amenities: string[]
}

export interface ExternalInquiry {
  externalId: string
  name: string
  email: string | null
  phone: string | null
  message: string
  /** Id de la publicación en el portal, para asociarla a la propiedad. */
  externalListingId: string | null
  createdAt: Date
}

/**
 * Qué falta para poder publicar. Lista vacía = lista. Los textos son los que
 * ve el personal (`LISTING_NOT_READY.missing`).
 */
export function missingForPublish(property: {
  available: boolean
  price: string | null
  photoCount: number
  description: string | null
}): string[] {
  const missing: string[] = []
  if (!property.available)
    missing.push('La propiedad tiene que estar disponible')
  if (!property.price) missing.push('Falta el precio de publicación')
  if (property.photoCount === 0) missing.push('Falta al menos una foto')
  if (!property.description?.trim())
    missing.push('Falta la descripción pública')
  return missing
}

/** Hash estable de lo que se publica, para detectar cambios sin publicar. */
export function payloadHash(payload: ListingPayload): string {
  const ordered = {
    ...payload,
    amenities: [...payload.amenities].sort(),
  }
  return createHash('sha256')
    .update(JSON.stringify(ordered, Object.keys(ordered).sort()))
    .digest('hex')
}

/** Acciones sobre una publicación y desde qué estados valen. */
export const LISTING_TRANSITIONS: Record<
  'pause' | 'resume' | 'close' | 'retry' | 'update',
  ListingStatus[]
> = {
  pause: [ListingStatus.PUBLISHED],
  resume: [ListingStatus.PAUSED],
  close: [ListingStatus.PUBLISHED, ListingStatus.PAUSED, ListingStatus.ERROR],
  retry: [ListingStatus.ERROR],
  update: [ListingStatus.PUBLISHED, ListingStatus.PAUSED],
}

export function canTransition(
  action: keyof typeof LISTING_TRANSITIONS,
  status: ListingStatus,
): boolean {
  return LISTING_TRANSITIONS[action].includes(status)
}
