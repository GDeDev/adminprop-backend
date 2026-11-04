/** Columnas del tablero (Fase 23, 3.1). Coinciden con el enum de Prisma. */
export enum InquiryStage {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  VISIT_SCHEDULED = 'VISIT_SCHEDULED',
  PROPOSAL_SENT = 'PROPOSAL_SENT',
  CLOSED_WON = 'CLOSED_WON',
  CLOSED_LOST = 'CLOSED_LOST',
}

export const INQUIRY_STAGES: readonly InquiryStage[] = [
  InquiryStage.NEW,
  InquiryStage.CONTACTED,
  InquiryStage.VISIT_SCHEDULED,
  InquiryStage.PROPOSAL_SENT,
  InquiryStage.CLOSED_WON,
  InquiryStage.CLOSED_LOST,
]

export const CLOSED_STAGES: readonly InquiryStage[] = [
  InquiryStage.CLOSED_WON,
  InquiryStage.CLOSED_LOST,
]

export enum InquirySource {
  PORTAL = 'PORTAL',
  MERCADOLIBRE = 'MERCADOLIBRE',
  ZONAPROP = 'ZONAPROP',
  ARGENPROP = 'ARGENPROP',
  WHATSAPP = 'WHATSAPP',
  PHONE = 'PHONE',
  MANUAL = 'MANUAL',
}

export const INQUIRY_SOURCES: readonly InquirySource[] =
  Object.values(InquirySource)

/** Orígenes que se pueden cargar a mano (`POST /crm/inquiries`). */
export const MANUAL_SOURCES: readonly InquirySource[] = [
  InquirySource.WHATSAPP,
  InquirySource.PHONE,
  InquirySource.MANUAL,
  InquirySource.ZONAPROP,
  InquirySource.ARGENPROP,
]

export enum InquiryActivityType {
  CREATED = 'CREATED',
  STAGE_CHANGED = 'STAGE_CHANGED',
  ASSIGNED = 'ASSIGNED',
  NOTE = 'NOTE',
  CONTACT_ATTEMPT = 'CONTACT_ATTEMPT',
  FOLLOW_UP_SET = 'FOLLOW_UP_SET',
  EDITED = 'EDITED',
}

export enum ContactChannel {
  WHATSAPP = 'WHATSAPP',
  PHONE = 'PHONE',
  EMAIL = 'EMAIL',
}

/** Largo máximo de una nota (Fase 23, 5). */
export const MAX_NOTE_LENGTH = 2000
/** Cuántas tarjetas trae cada columna del pipeline. */
export const PIPELINE_COLUMN_LIMIT = 50
/** Largo del mensaje que se muestra en la tarjeta. */
export const CARD_MESSAGE_LENGTH = 140
/** Motivos sugeridos al cerrar como perdida (la UI los ofrece; el texto es libre). */
export const LOST_REASONS = [
  'No respondió',
  'Eligió otra propiedad',
  'Precio',
  'Ya no busca',
  'Otro',
] as const

export interface Inquiry {
  id: string
  name: string
  email: string | null
  phone: string | null
  message: string
  /** Id plano: la propiedad puede haberse borrado después. */
  propertyId: string | null
  source: InquirySource
  stage: InquiryStage
  stageChangedAt: Date
  boardPosition: number
  assignedToId: string | null
  /** Día calendario `AAAA-MM-DD`. */
  nextActionAt: string | null
  lastContactAt: Date | null
  lostReason: string | null
  closedAt: Date | null
  contractId: string | null
  externalId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface InquiryActivity {
  id: string
  inquiryId: string
  type: InquiryActivityType
  authorId: string | null
  payload: Record<string, unknown>
  createdAt: Date
}
