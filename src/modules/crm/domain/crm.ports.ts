import {
  Inquiry,
  InquiryActivity,
  InquiryActivityType,
  InquirySource,
  InquiryStage,
} from './inquiry'
import {
  ChannelState,
  ListingChannel,
  ListingChannelAccountData,
  ListingStatus,
  PropertyListingData,
} from './listing'

export interface NewInquiry {
  name: string
  email: string | null
  phone: string | null
  message: string
  propertyId: string | null
  source: InquirySource
  assignedToId: string | null
  externalId: string | null
  ip: string | null
  boardPosition: number
  /** Para las que traen fecha propia (consultas de un portal). */
  createdAt?: Date
}

export interface InquiryFilter {
  stage?: InquiryStage
  assignedToId?: string
  unassigned?: boolean
  propertyId?: string
  source?: InquirySource
  /** Busca en nombre, email, teléfono y mensaje. */
  q?: string
}

export type InquiryPatch = Partial<
  Pick<
    Inquiry,
    | 'name'
    | 'email'
    | 'phone'
    | 'propertyId'
    | 'nextActionAt'
    | 'assignedToId'
    | 'stage'
    | 'stageChangedAt'
    | 'boardPosition'
    | 'lastContactAt'
    | 'lostReason'
    | 'closedAt'
    | 'contractId'
  >
>

/** Dentro del tenant del contexto; el filtro lo pone la extensión de Prisma. */
export abstract class InquiryRepository {
  abstract create(data: NewInquiry): Promise<Inquiry>

  abstract findById(id: string): Promise<Inquiry | null>

  abstract update(id: string, patch: InquiryPatch): Promise<Inquiry>

  /** Por `boardPosition`, en una columna; `skip`/`take` para "ver más". */
  abstract listByStage(
    stage: InquiryStage,
    filter: Omit<InquiryFilter, 'stage'>,
    page: { skip: number; take: number },
  ): Promise<[Inquiry[], number]>

  /** Lista plana (mobile): más nuevas primero. */
  abstract list(
    filter: InquiryFilter,
    page: { skip: number; take: number },
  ): Promise<[Inquiry[], number]>

  /** Posiciones de una columna ordenadas, para calcular el vecino y renumerar. */
  abstract columnPositions(
    stage: InquiryStage,
  ): Promise<{ id: string; boardPosition: number }[]>

  abstract setPositions(
    entries: { id: string; boardPosition: number }[],
  ): Promise<void>

  /** Menor posición de la columna, para insertar arriba. */
  abstract minPosition(stage: InquiryStage): Promise<number | null>

  abstract findByExternalId(
    source: InquirySource,
    externalId: string,
  ): Promise<Inquiry | null>

  /** Cuántas consultas llegaron desde esa IP, y con ese email, desde `since`. */
  abstract countSince(
    since: Date,
    by: { ip: string | null; email: string },
  ): Promise<{ byIp: number; byEmail: number }>

  /** Abiertas con seguimiento vencido a `day` (inclusive). */
  abstract listFollowUpsDue(day: string): Promise<Inquiry[]>

  // Analítica -----------------------------------------------------------
  abstract countByStage(range: DateRange): Promise<Record<InquiryStage, number>>

  abstract countBySource(
    range: DateRange,
  ): Promise<Record<InquirySource, number>>

  abstract countUnassignedOpen(): Promise<number>

  /** Fecha de alta y primer contacto de las que ya tuvieron contacto. */
  abstract firstContactDeltas(range: DateRange): Promise<number[]>

  abstract countsByProperty(
    range: DateRange,
  ): Promise<{ propertyId: string; inquiries: number }[]>

  abstract forProperty(
    propertyId: string,
    range: DateRange,
  ): Promise<{ stage: InquiryStage; source: InquirySource; createdAt: Date }[]>
}

export interface DateRange {
  from: Date
  to: Date
}

export abstract class InquiryActivityRepository {
  abstract add(data: {
    inquiryId: string
    type: InquiryActivityType
    authorId: string | null
    payload: Record<string, unknown>
  }): Promise<InquiryActivity>

  /** Más viejas primero. */
  abstract listFor(inquiryId: string): Promise<InquiryActivity[]>
}

export abstract class PropertyViewRepository {
  /** Suma una vista al día de la propiedad. */
  abstract increment(propertyId: string, day: string): Promise<void>

  abstract totalFor(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<number>

  abstract dailyFor(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<{ day: string; views: number }[]>

  abstract totalsByProperty(
    from: string,
    to: string,
  ): Promise<{ propertyId: string; views: number }[]>
}

export interface ChannelAccountPatch {
  status?: ChannelState
  accountLabel?: string | null
  tokens?: {
    accessToken: string
    refreshToken: string | null
    expiresAt: Date | null
  } | null
  connectedById?: string | null
  connectedAt?: Date | null
  lastError?: string | null
  lastInquirySyncAt?: Date | null
}

export abstract class ListingChannelRepository {
  abstract find(
    channel: ListingChannel,
  ): Promise<ListingChannelAccountData | null>

  abstract list(): Promise<ListingChannelAccountData[]>

  /** Crea o actualiza la cuenta del canal; cifra los tokens al guardar. */
  abstract save(
    channel: ListingChannel,
    patch: ChannelAccountPatch,
  ): Promise<ListingChannelAccountData>

  /** Cuentas conectadas, para el job de consultas entrantes. */
  abstract listConnected(): Promise<ListingChannelAccountData[]>
}

export interface ListingPatch {
  externalId?: string | null
  externalUrl?: string | null
  status?: ListingStatus
  payloadHash?: string | null
  publishedAt?: Date | null
  lastSyncedAt?: Date | null
  lastError?: string | null
}

export abstract class PropertyListingRepository {
  abstract find(
    propertyId: string,
    channel: ListingChannel,
  ): Promise<PropertyListingData | null>

  abstract listForProperty(propertyId: string): Promise<PropertyListingData[]>

  abstract upsert(
    propertyId: string,
    channel: ListingChannel,
    patch: ListingPatch,
  ): Promise<PropertyListingData>

  /** Publicaciones `PUBLISHED` o `PAUSED` de una propiedad (cierre automático). */
  abstract listActiveForProperty(
    propertyId: string,
  ): Promise<PropertyListingData[]>
}
