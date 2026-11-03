import {
  CommandHandler,
  EventBus,
  EventsHandler,
  ICommandHandler,
  IEventHandler,
} from '@nestjs/cqrs'
import { randomUUID } from 'node:crypto'

import { PropertiesFacade } from '@/modules/properties/public'
import { EmailPort } from '@/platform/email/email.port'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { AppException } from '@/shared/errors'
import { createLogger } from '@/shared/logging/root-logger'
import { INQUIRY_WINDOW_MINUTES } from '../domain/public-inquiry'
import { PublicInquiryPolicy } from '../domain/public-inquiry.policy'
import {
  InquiryPropertyNotAvailableException,
  PublicInquiryNotFoundException,
} from '../domain/public.exceptions'
import { PublicInquiryRepository } from '../domain/public.ports'
import { PublicInquiryCreatedEvent } from './public-inquiry-created.event'
import { PublicTenantScope } from './public-tenant-scope'
import {
  SubmitPublicInquiryCommand,
  UpdatePublicInquiryStatusCommand,
} from './public.commands'
import { PublicInquiryView, PublicInquiryViews } from './public.views'

/**
 * Formulario de contacto del portal (Fase 22, 2). En orden:
 *
 * 1. Honeypot: si el campo trampa viene con texto se responde 201 igual (el
 *    bot no se entera) y no se guarda nada.
 * 2. Límite: 5 consultas por hora por IP y por email. Se cuenta contra la
 *    propia tabla, así vale con varias instancias y es lo que prueban los e2e.
 * 3. La propiedad, si viene, tiene que seguir disponible.
 */
@CommandHandler(SubmitPublicInquiryCommand)
export class SubmitPublicInquiryHandler implements ICommandHandler<
  SubmitPublicInquiryCommand,
  { id: string }
> {
  private readonly logger = createLogger('SubmitPublicInquiryHandler')

  constructor(
    private readonly scope: PublicTenantScope,
    private readonly inquiries: PublicInquiryRepository,
    private readonly properties: PropertiesFacade,
    private readonly events: EventBus,
  ) {}

  async execute({
    slug,
    input,
    ip,
  }: SubmitPublicInquiryCommand): Promise<{ id: string }> {
    return this.scope.run(slug, async (tenant) => {
      if (PublicInquiryPolicy.isBot(input.website)) {
        this.logger.warn(
          { tenantId: tenant.id, ip },
          'Consulta descartada por el honeypot',
        )
        return { id: randomUUID() }
      }

      const contact = PublicInquiryPolicy.normalize(input)

      const since = new Date(Date.now() - INQUIRY_WINDOW_MINUTES * 60_000)
      const recent = await this.inquiries.countSince(since, {
        ip,
        email: contact.email,
      })
      if (PublicInquiryPolicy.isOverLimit(recent.byIp, recent.byEmail)) {
        throw AppException.tooManyRequests(
          'Enviaste varias consultas en poco tiempo. Probá de nuevo en un rato o escribinos por WhatsApp.',
        )
      }

      const property = input.propertyId
        ? await this.properties.publicRef(input.propertyId)
        : null
      if (input.propertyId && !property) {
        throw new InquiryPropertyNotAvailableException()
      }

      const inquiry = await this.inquiries.create({
        ...contact,
        propertyId: property?.id ?? null,
        ip,
      })

      this.events.publish(
        new PublicInquiryCreatedEvent(
          tenant.id,
          tenant.email,
          inquiry.id,
          inquiry.name,
          inquiry.email,
          inquiry.phone,
          inquiry.message,
          property,
        ),
      )
      return { id: inquiry.id }
    })
  }
}

/**
 * Avisa al personal: una alerta en la campana (Fase 13) y, si la inmobiliaria
 * tiene email de contacto, un correo con los datos de la consulta. Nada de esto
 * puede hacer fallar la consulta, que ya quedó guardada.
 */
@EventsHandler(PublicInquiryCreatedEvent)
export class NotifyStaffOnInquiryHandler implements IEventHandler<PublicInquiryCreatedEvent> {
  private readonly logger = createLogger('NotifyStaffOnInquiry')

  constructor(
    private readonly notifications: NotificationsService,
    private readonly email: EmailPort,
  ) {}

  async handle(event: PublicInquiryCreatedEvent): Promise<void> {
    const about = event.property ? ` sobre ${event.property.address}` : ''

    try {
      await this.notifications.notifyStaff({
        tenantId: event.tenantId,
        type: 'PUBLIC_INQUIRY',
        title: `Nueva consulta de ${event.name}`,
        body: `${event.name} escribió desde el portal${about}.`,
        dedupeKey: `PUBLIC_INQUIRY:${event.inquiryId}`,
        entity: { type: 'PublicInquiry', id: event.inquiryId },
        link: '/crm',
      })
    } catch (error) {
      this.logger.error(
        { err: error, inquiryId: event.inquiryId },
        'No se pudo crear el aviso interno de la consulta',
      )
    }

    if (!event.tenantEmail) return
    try {
      await this.email.send({
        to: event.tenantEmail,
        subject: `Nueva consulta de ${event.name}${about}`,
        text: [
          `Llegó una consulta desde el portal${about}.`,
          '',
          `Nombre: ${event.name}`,
          `Email: ${event.email}`,
          `Teléfono: ${event.phone}`,
          '',
          event.message,
        ].join('\n'),
        replyTo: event.email,
      })
    } catch (error) {
      this.logger.error(
        { err: error, inquiryId: event.inquiryId },
        'No se pudo enviar el email de la consulta',
      )
    }
  }
}

@CommandHandler(UpdatePublicInquiryStatusCommand)
export class UpdatePublicInquiryStatusHandler implements ICommandHandler<
  UpdatePublicInquiryStatusCommand,
  PublicInquiryView
> {
  constructor(
    private readonly inquiries: PublicInquiryRepository,
    private readonly views: PublicInquiryViews,
  ) {}

  async execute({
    id,
    status,
  }: UpdatePublicInquiryStatusCommand): Promise<PublicInquiryView> {
    const current = await this.inquiries.findById(id)
    if (!current) throw new PublicInquiryNotFoundException(id)
    const updated =
      current.status === status
        ? current
        : await this.inquiries.updateStatus(id, status)
    return (await this.views.of([updated]))[0]
  }
}
