import {
  CommandHandler,
  ICommandHandler,
  IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs'

import { UsersFacade } from '@/modules/auth/public'
import { ContractsFacade } from '@/modules/contracts/public'
import { NotificationsFacade } from '@/modules/notifications/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { DomainErrorKind, DomainException } from '@/shared/errors'
import { PaginatedResult } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import { buildWhatsAppLink } from '@/shared/whatsapp/whatsapp'
import {
  CrmContractNotFoundException,
  CrmPropertyNotFoundException,
  InquiryContactRequiredException,
  InquiryNotFoundException,
  InvalidBoardNeighbourException,
  LostReasonRequiredException,
  WhatsAppTemplateNotFoundException,
} from '../domain/crm.exceptions'
import {
  InquiryActivityRepository,
  InquiryPatch,
  InquiryRepository,
} from '../domain/crm.ports'
import {
  EXTERNAL_SOURCES,
  Inquiry,
  InquiryActivityType,
  InquiryStage,
  INQUIRY_STAGES,
  MANUAL_SOURCES,
  PIPELINE_COLUMN_LIMIT,
} from '../domain/inquiry'
import { InquiryPolicy } from '../domain/inquiry.policy'
import { InquiryNotifier } from './inquiry-notifier'
import { InquiryRegistrar } from './inquiry-registrar'
import {
  AddInquiryNoteCommand,
  AssignInquiryCommand,
  CreateInquiryCommand,
  GetInquiryQuery,
  GetPipelineQuery,
  GetWhatsAppLinkQuery,
  ListAssigneesQuery,
  ListInquiriesQuery,
  MoveInquiryCommand,
  RecordContactAttemptCommand,
  UpdateInquiryCommand,
} from './crm.messages'
import {
  InquiryActivityView,
  InquiryCardView,
  InquiryDetailView,
  InquiryViews,
  PipelineView,
} from './crm.views'

const DEFAULT_WHATSAPP_TEMPLATE = 'INQUIRY_FIRST_CONTACT'

class MissingInquirySourceException extends DomainException {
  constructor() {
    super(
      'INQUIRY_SOURCE_INVALID',
      'El origen no se puede cargar a mano',
      DomainErrorKind.InvalidInput,
    )
  }
}

/** Busca la consulta del tenant del contexto o tira `INQUIRY_NOT_FOUND`. */
async function requireInquiry(
  inquiries: InquiryRepository,
  id: string,
): Promise<Inquiry> {
  const inquiry = await inquiries.findById(id)
  if (!inquiry) throw new InquiryNotFoundException(id)
  return inquiry
}

// ------------------------------------------------------------------- Alta

@CommandHandler(CreateInquiryCommand)
export class CreateInquiryHandler implements ICommandHandler<
  CreateInquiryCommand,
  InquiryDetailView
> {
  constructor(
    private readonly registrar: InquiryRegistrar,
    private readonly properties: PropertiesFacade,
    private readonly activities: InquiryActivityRepository,
    private readonly views: InquiryViews,
    private readonly notifier: InquiryNotifier,
  ) {}

  async execute({ input }: CreateInquiryCommand): Promise<InquiryDetailView> {
    if (!MANUAL_SOURCES.includes(input.source)) {
      throw new MissingInquirySourceException()
    }
    if (input.propertyId) {
      const found = await this.properties.describe([input.propertyId])
      if (!found.has(input.propertyId)) {
        throw new CrmPropertyNotFoundException(input.propertyId)
      }
    }
    const { inquiry } = await this.registrar.register(input)
    if (inquiry.assignedToId) {
      await this.activities.add({
        inquiryId: inquiry.id,
        type: InquiryActivityType.ASSIGNED,
        authorId: RequestContext.userId ?? null,
        payload: { from: null, to: inquiry.assignedToId },
      })
      await this.notifier.assigned(inquiry)
    }
    return this.views.detail(inquiry, await this.activities.listFor(inquiry.id))
  }
}

// ----------------------------------------------------------------- Edición

@CommandHandler(UpdateInquiryCommand)
export class UpdateInquiryHandler implements ICommandHandler<
  UpdateInquiryCommand,
  InquiryDetailView
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly activities: InquiryActivityRepository,
    private readonly properties: PropertiesFacade,
    private readonly views: InquiryViews,
  ) {}

  async execute({
    id,
    patch,
  }: UpdateInquiryCommand): Promise<InquiryDetailView> {
    const current = await requireInquiry(this.inquiries, id)

    const email =
      patch.email !== undefined
        ? patch.email.trim().toLowerCase() || null
        : current.email
    const phone =
      patch.phone !== undefined
        ? patch.phone.replace(/\s+/g, ' ').trim() || null
        : current.phone
    if (
      !InquiryPolicy.hasContact(email, phone) &&
      !EXTERNAL_SOURCES.includes(current.source)
    ) {
      throw new InquiryContactRequiredException()
    }
    if (patch.propertyId) {
      const found = await this.properties.describe([patch.propertyId])
      if (!found.has(patch.propertyId)) {
        throw new CrmPropertyNotFoundException(patch.propertyId)
      }
    }

    const update: InquiryPatch = {}
    const changed: string[] = []
    if (patch.name !== undefined && patch.name.trim() !== current.name) {
      update.name = patch.name.replace(/\s+/g, ' ').trim()
      changed.push('name')
    }
    if (email !== current.email) {
      update.email = email
      changed.push('email')
    }
    if (phone !== current.phone) {
      update.phone = phone
      changed.push('phone')
    }
    if (patch.propertyId && patch.propertyId !== current.propertyId) {
      update.propertyId = patch.propertyId
      changed.push('propertyId')
    }
    const followUpChanged =
      patch.nextActionAt !== undefined &&
      patch.nextActionAt !== current.nextActionAt
    if (followUpChanged)
      update.nextActionAt = patch.nextActionAt as string | null

    const updated =
      Object.keys(update).length > 0
        ? await this.inquiries.update(id, update)
        : current
    const authorId = RequestContext.userId ?? null
    if (changed.length > 0) {
      await this.activities.add({
        inquiryId: id,
        type: InquiryActivityType.EDITED,
        authorId,
        payload: { fields: changed },
      })
    }
    if (followUpChanged) {
      await this.activities.add({
        inquiryId: id,
        type: InquiryActivityType.FOLLOW_UP_SET,
        authorId,
        payload: { from: current.nextActionAt, to: updated.nextActionAt },
      })
    }
    return this.views.detail(updated, await this.activities.listFor(id))
  }
}

// ------------------------------------------------------------------ Tablero

@CommandHandler(MoveInquiryCommand)
export class MoveInquiryHandler implements ICommandHandler<
  MoveInquiryCommand,
  InquiryCardView
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly activities: InquiryActivityRepository,
    private readonly views: InquiryViews,
    private readonly contracts: ContractsFacade,
  ) {}

  async execute({ id, move }: MoveInquiryCommand): Promise<InquiryCardView> {
    const current = await requireInquiry(this.inquiries, id)
    if (InquiryPolicy.lostReasonMissing(move.stage, move.lostReason)) {
      throw new LostReasonRequiredException()
    }
    // Como con la propiedad: antes se guardaba cualquier id, incluso el de un
    // contrato de otra inmobiliaria, y la ficha lo mostraba como vinculado.
    if (move.contractId && !(await this.contracts.exists(move.contractId))) {
      throw new CrmContractNotFoundException(move.contractId)
    }

    const position = await this.positionFor(current, move)
    const stageChanged = move.stage !== current.stage
    const change = stageChanged
      ? InquiryPolicy.applyStage(current, move.stage, new Date(), {
          lostReason: move.lostReason,
          contractId: move.contractId,
        })
      : null

    const updated = await this.inquiries.update(id, {
      ...(change ?? {}),
      ...(position !== null ? { boardPosition: position } : {}),
    })
    if (change) {
      await this.activities.add({
        inquiryId: id,
        type: InquiryActivityType.STAGE_CHANGED,
        authorId: RequestContext.userId ?? null,
        payload: {
          from: current.stage,
          to: move.stage,
          ...(change.lostReason ? { lostReason: change.lostReason } : {}),
          ...(change.contractId ? { contractId: change.contractId } : {}),
        },
      })
    }
    return this.views.card(updated)
  }

  /**
   * Posición dentro de la columna de destino a partir de los vecinos (A-82).
   * Sin vecinos, una tarjeta que cambia de columna va arriba; una que ya está
   * en esa columna no se mueve (null).
   */
  private async positionFor(
    current: Inquiry,
    move: { stage: InquiryStage; beforeId?: string; afterId?: string },
  ): Promise<number | null> {
    const hasNeighbour = Boolean(move.beforeId || move.afterId)
    if (!hasNeighbour && move.stage === current.stage) return null

    const others = (await this.inquiries.columnPositions(move.stage)).filter(
      (entry) => entry.id !== current.id,
    )
    const indexOf = (neighbourId: string | undefined): number => {
      if (!neighbourId) return -1
      const index = others.findIndex((entry) => entry.id === neighbourId)
      if (index < 0) throw new InvalidBoardNeighbourException()
      return index
    }
    const beforeIndex = indexOf(move.beforeId)
    const afterIndex = indexOf(move.afterId)

    // `before` queda arriba y `after` abajo; si falta uno, es el vecino contiguo.
    let upper: number | null = null
    let lower: number | null = null
    if (hasNeighbour) {
      const upperIndex =
        beforeIndex >= 0 ? beforeIndex : afterIndex >= 0 ? afterIndex - 1 : -1
      const lowerIndex =
        afterIndex >= 0 ? afterIndex : beforeIndex >= 0 ? beforeIndex + 1 : -1
      upper = upperIndex >= 0 ? others[upperIndex].boardPosition : null
      lower =
        lowerIndex >= 0 && lowerIndex < others.length
          ? others[lowerIndex].boardPosition
          : null
    } else {
      lower = others[0]?.boardPosition ?? null
    }

    const position = InquiryPolicy.positionBetween(upper, lower)
    if (position !== null) return position

    // Sin precisión: se renumera la columna y se recalcula (A-82).
    const fresh = InquiryPolicy.renumber(others.length)
    await this.inquiries.setPositions(
      others.map((entry, i) => ({ id: entry.id, boardPosition: fresh[i] })),
    )
    const upperIndex = hasNeighbour
      ? beforeIndex >= 0
        ? beforeIndex
        : afterIndex - 1
      : -1
    return InquiryPolicy.positionBetween(
      upperIndex >= 0 ? fresh[upperIndex] : null,
      upperIndex + 1 < fresh.length ? fresh[upperIndex + 1] : null,
    )
  }
}

@CommandHandler(AssignInquiryCommand)
export class AssignInquiryHandler implements ICommandHandler<
  AssignInquiryCommand,
  InquiryCardView
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly activities: InquiryActivityRepository,
    private readonly registrar: InquiryRegistrar,
    private readonly notifier: InquiryNotifier,
    private readonly views: InquiryViews,
  ) {}

  async execute({
    id,
    userId,
  }: AssignInquiryCommand): Promise<InquiryCardView> {
    const current = await requireInquiry(this.inquiries, id)
    if (userId) await this.registrar.assertAssignable(userId)
    if (userId === current.assignedToId) return this.views.card(current)

    const updated = await this.inquiries.update(id, { assignedToId: userId })
    await this.activities.add({
      inquiryId: id,
      type: InquiryActivityType.ASSIGNED,
      authorId: RequestContext.userId ?? null,
      payload: { from: current.assignedToId, to: userId },
    })
    await this.notifier.assigned(updated)
    return this.views.card(updated)
  }
}

// ----------------------------------------------------- Notas y contacto

@CommandHandler(AddInquiryNoteCommand)
export class AddInquiryNoteHandler implements ICommandHandler<
  AddInquiryNoteCommand,
  InquiryActivityView
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly activities: InquiryActivityRepository,
    private readonly users: UsersFacade,
  ) {}

  async execute({
    id,
    body,
  }: AddInquiryNoteCommand): Promise<InquiryActivityView> {
    await requireInquiry(this.inquiries, id)
    const authorId = RequestContext.userId ?? null
    const activity = await this.activities.add({
      inquiryId: id,
      type: InquiryActivityType.NOTE,
      authorId,
      payload: { body: body.trim() },
    })
    const author = authorId
      ? (await this.users.describe([authorId])).get(authorId)
      : null
    return {
      id: activity.id,
      type: activity.type,
      author: author ?? null,
      payload: activity.payload,
      createdAt: activity.createdAt,
    }
  }
}

@CommandHandler(RecordContactAttemptCommand)
export class RecordContactAttemptHandler implements ICommandHandler<
  RecordContactAttemptCommand,
  InquiryCardView
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly activities: InquiryActivityRepository,
    private readonly views: InquiryViews,
  ) {}

  async execute({
    id,
    channel,
  }: RecordContactAttemptCommand): Promise<InquiryCardView> {
    const current = await requireInquiry(this.inquiries, id)
    const now = new Date()
    const authorId = RequestContext.userId ?? null
    await this.activities.add({
      inquiryId: id,
      type: InquiryActivityType.CONTACT_ATTEMPT,
      authorId,
      payload: { channel },
    })

    // El primer contacto saca la consulta de NEW (Fase 23, 5).
    if (current.stage === InquiryStage.NEW) {
      const min = await this.inquiries.minPosition(InquiryStage.CONTACTED)
      const change = InquiryPolicy.applyStage(
        current,
        InquiryStage.CONTACTED,
        now,
      )
      const updated = await this.inquiries.update(id, {
        ...change,
        lastContactAt: now,
        boardPosition: min === null ? 1000 : min - 1000,
      })
      await this.activities.add({
        inquiryId: id,
        type: InquiryActivityType.STAGE_CHANGED,
        authorId,
        payload: { from: InquiryStage.NEW, to: InquiryStage.CONTACTED },
      })
      return this.views.card(updated)
    }
    return this.views.card(
      await this.inquiries.update(id, { lastContactAt: now }),
    )
  }
}

// ------------------------------------------------------------------ Consultas

function toFilter(filter: {
  assignedToId?: string
  propertyId?: string
  source?: Inquiry['source']
  q?: string
  unassigned?: boolean
}) {
  return {
    assignedToId: filter.assignedToId,
    propertyId: filter.propertyId,
    source: filter.source,
    q: filter.q,
    unassigned: filter.unassigned,
  }
}

@QueryHandler(GetPipelineQuery)
export class GetPipelineHandler implements IQueryHandler<
  GetPipelineQuery,
  PipelineView
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly views: InquiryViews,
  ) {}

  async execute({ filter }: GetPipelineQuery): Promise<PipelineView> {
    const columns = await Promise.all(
      INQUIRY_STAGES.map(async (stage) => {
        const [items, total] = await this.inquiries.listByStage(
          stage,
          toFilter(filter),
          { skip: 0, take: PIPELINE_COLUMN_LIMIT },
        )
        return { stage, total, cards: await this.views.cards(items) }
      }),
    )
    return { columns }
  }
}

@QueryHandler(ListInquiriesQuery)
export class ListInquiriesHandler implements IQueryHandler<
  ListInquiriesQuery,
  PaginatedResult<InquiryCardView>
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly views: InquiryViews,
  ) {}

  execute({
    filter,
    page,
  }: ListInquiriesQuery): Promise<PaginatedResult<InquiryCardView>> {
    return paginateWith(page, async (args) => {
      // Dentro de una columna se respeta el orden del tablero ("ver más").
      const [items, total] = filter.stage
        ? await this.inquiries.listByStage(filter.stage, toFilter(filter), args)
        : await this.inquiries.list(toFilter(filter), args)
      return [await this.views.cards(items), total]
    })
  }
}

@QueryHandler(GetInquiryQuery)
export class GetInquiryHandler implements IQueryHandler<
  GetInquiryQuery,
  InquiryDetailView
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly activities: InquiryActivityRepository,
    private readonly views: InquiryViews,
  ) {}

  async execute({ id }: GetInquiryQuery): Promise<InquiryDetailView> {
    const inquiry = await requireInquiry(this.inquiries, id)
    return this.views.detail(inquiry, await this.activities.listFor(id))
  }
}

@QueryHandler(GetWhatsAppLinkQuery)
export class GetWhatsAppLinkHandler implements IQueryHandler<
  GetWhatsAppLinkQuery,
  { url: string | null; message: string }
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly properties: PropertiesFacade,
    private readonly notifications: NotificationsFacade,
    private readonly tenants: TenantsFacade,
  ) {}

  async execute({
    id,
    templateKey,
  }: GetWhatsAppLinkQuery): Promise<{ url: string | null; message: string }> {
    const inquiry = await requireInquiry(this.inquiries, id)
    const key = templateKey ?? DEFAULT_WHATSAPP_TEMPLATE
    const address = inquiry.propertyId
      ? (await this.properties.describe([inquiry.propertyId])).get(
          inquiry.propertyId,
        )?.address
      : undefined
    const branding = await this.tenants.branding(
      RequestContext.tenantId as string,
    )
    const message = await this.notifications.renderWhatsApp(key, {
      name: inquiry.name,
      recipientName: inquiry.name,
      // Consulta general: la plantilla sigue leyéndose bien (A-150).
      propertyAddress: address ?? 'nuestras propiedades',
      agencyName: branding.name,
    })
    if (message === null) throw new WhatsAppTemplateNotFoundException(key)
    return { url: buildWhatsAppLink(inquiry.phone, message), message }
  }
}

@QueryHandler(ListAssigneesQuery)
export class ListAssigneesHandler implements IQueryHandler<
  ListAssigneesQuery,
  { id: string; fullName: string; role: string }[]
> {
  constructor(private readonly users: UsersFacade) {}

  async execute(): Promise<{ id: string; fullName: string; role: string }[]> {
    const staff = await this.users.listStaffContacts()
    return staff
      .map((contact) => ({
        id: contact.userId,
        fullName: contact.fullName,
        role: contact.role,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'))
  }
}
