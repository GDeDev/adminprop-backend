import { AppException } from '@/shared/errors'
import {
  PublicInquirySource,
  PublicInquiryStatus,
} from '../domain/public-inquiry'
import {
  InquiryPropertyNotAvailableException,
  PublicInquiryNotFoundException,
  PublicTenantNotFoundException,
} from '../domain/public.exceptions'
import { PublicInquiryCreatedEvent } from './public-inquiry-created.event'
import { PublicTenantScope } from './public-tenant-scope'
import {
  PublicContactInput,
  SubmitPublicInquiryCommand,
} from './public.commands'
import {
  NotifyStaffOnInquiryHandler,
  SubmitPublicInquiryHandler,
  UpdatePublicInquiryStatusHandler,
} from './public.handlers'

const TENANT = {
  id: 't1',
  name: 'Inmobiliaria A',
  slug: 'a',
  email: 'info@a.com',
  defaultCurrency: 'ARS' as const,
}

const INQUIRY = {
  id: 'i1',
  name: 'Ana',
  email: 'ana@mail.com',
  phone: '',
  message: 'Hola',
  propertyId: null,
  status: PublicInquiryStatus.NEW,
  source: PublicInquirySource.PORTAL,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const INPUT: PublicContactInput = {
  name: 'Ana',
  email: 'ANA@mail.com',
  phone: '',
  message: 'Hola',
  propertyId: null,
  website: '',
}

describe('SubmitPublicInquiryHandler', () => {
  let tenants: { findActiveBySlug: jest.Mock }
  let inquiries: { countSince: jest.Mock; create: jest.Mock }
  let properties: { publicRef: jest.Mock }
  let events: { publish: jest.Mock }
  let handler: SubmitPublicInquiryHandler

  beforeEach(() => {
    tenants = { findActiveBySlug: jest.fn().mockResolvedValue(TENANT) }
    inquiries = {
      countSince: jest.fn().mockResolvedValue({ byIp: 0, byEmail: 0 }),
      create: jest.fn().mockResolvedValue(INQUIRY),
    }
    properties = { publicRef: jest.fn() }
    events = { publish: jest.fn() }
    handler = new SubmitPublicInquiryHandler(
      new PublicTenantScope(tenants as never),
      inquiries as never,
      properties as never,
      events as never,
    )
  })

  const submit = (input = INPUT) =>
    handler.execute(new SubmitPublicInquiryCommand('a', input, '1.2.3.4'))

  it('guarda la consulta normalizada y avisa con un evento', async () => {
    await expect(submit()).resolves.toEqual({ id: 'i1' })

    expect(inquiries.create).toHaveBeenCalledWith({
      name: 'Ana',
      email: 'ana@mail.com',
      phone: '',
      message: 'Hola',
      propertyId: null,
      ip: '1.2.3.4',
    })
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', inquiryId: 'i1' }),
    )
  })

  it('con el honeypot lleno responde bien pero no guarda ni avisa', async () => {
    const result = await submit({ ...INPUT, website: 'http://spam.example' })

    expect(result.id).toEqual(expect.any(String))
    expect(inquiries.create).not.toHaveBeenCalled()
    expect(events.publish).not.toHaveBeenCalled()
  })

  it('rechaza con 429 al llegar al tope por IP', async () => {
    inquiries.countSince.mockResolvedValue({ byIp: 5, byEmail: 0 })

    await expect(submit()).rejects.toBeInstanceOf(AppException)
    expect(inquiries.create).not.toHaveBeenCalled()
  })

  it('rechaza con 429 al llegar al tope por email (se cuenta en minúsculas)', async () => {
    inquiries.countSince.mockResolvedValue({ byIp: 0, byEmail: 5 })

    await expect(submit()).rejects.toBeInstanceOf(AppException)
    expect(inquiries.countSince).toHaveBeenCalledWith(expect.any(Date), {
      ip: '1.2.3.4',
      email: 'ana@mail.com',
    })
  })

  it('una propiedad que ya no está disponible es un 409', async () => {
    properties.publicRef.mockResolvedValue(null)

    await expect(submit({ ...INPUT, propertyId: 'p1' })).rejects.toBeInstanceOf(
      InquiryPropertyNotAvailableException,
    )
    expect(inquiries.create).not.toHaveBeenCalled()
  })

  it('con una propiedad disponible la guarda y la nombra en el evento', async () => {
    properties.publicRef.mockResolvedValue({ id: 'p1', address: 'Calle 1' })

    await submit({ ...INPUT, propertyId: 'p1' })

    expect(inquiries.create).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'p1' }),
    )
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        property: { id: 'p1', address: 'Calle 1' },
      }),
    )
  })

  it('una inmobiliaria deshabilitada o inexistente es un 404', async () => {
    tenants.findActiveBySlug.mockResolvedValue(null)

    await expect(submit()).rejects.toBeInstanceOf(PublicTenantNotFoundException)
  })
})

describe('NotifyStaffOnInquiryHandler', () => {
  const event = new PublicInquiryCreatedEvent(
    't1',
    'info@a.com',
    'i1',
    'Ana',
    'ana@mail.com',
    '221',
    'Hola',
    { id: 'p1', address: 'Calle 1' },
  )

  it('crea el aviso interno y manda el email con reply-to al consultante', async () => {
    const notifications = { notifyStaff: jest.fn().mockResolvedValue('SENT') }
    const email = { send: jest.fn().mockResolvedValue(undefined) }

    await new NotifyStaffOnInquiryHandler(
      notifications as never,
      email as never,
    ).handle(event)

    expect(notifications.notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        type: 'PUBLIC_INQUIRY',
        dedupeKey: 'PUBLIC_INQUIRY:i1',
        entity: { type: 'PublicInquiry', id: 'i1' },
      }),
    )
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'info@a.com',
        replyTo: 'ana@mail.com',
      }),
    )
  })

  it('sin email de contacto sólo deja el aviso interno', async () => {
    const notifications = { notifyStaff: jest.fn().mockResolvedValue('SENT') }
    const email = { send: jest.fn() }
    const noEmail = new PublicInquiryCreatedEvent(
      't1',
      null,
      'i1',
      'Ana',
      'ana@mail.com',
      '',
      'Hola',
      null,
    )

    await new NotifyStaffOnInquiryHandler(
      notifications as never,
      email as never,
    ).handle(noEmail)

    expect(notifications.notifyStaff).toHaveBeenCalled()
    expect(email.send).not.toHaveBeenCalled()
  })

  it('si fallan el aviso y el email no lanza (la consulta ya está guardada)', async () => {
    const notifications = {
      notifyStaff: jest.fn().mockRejectedValue(new Error('db')),
    }
    const email = { send: jest.fn().mockRejectedValue(new Error('smtp')) }

    await expect(
      new NotifyStaffOnInquiryHandler(
        notifications as never,
        email as never,
      ).handle(event),
    ).resolves.toBeUndefined()
  })
})

describe('UpdatePublicInquiryStatusHandler', () => {
  it('cambia el estado', async () => {
    const inquiries = {
      findById: jest.fn().mockResolvedValue(INQUIRY),
      updateStatus: jest.fn().mockResolvedValue({
        ...INQUIRY,
        status: PublicInquiryStatus.CONTACTED,
      }),
    }
    const views = { of: jest.fn().mockImplementation(async (x) => x) }

    const result = await new UpdatePublicInquiryStatusHandler(
      inquiries as never,
      views as never,
    ).execute({ id: 'i1', status: PublicInquiryStatus.CONTACTED })

    expect(inquiries.updateStatus).toHaveBeenCalledWith(
      'i1',
      PublicInquiryStatus.CONTACTED,
    )
    expect(result.status).toBe(PublicInquiryStatus.CONTACTED)
  })

  it('una consulta inexistente (o de otra inmobiliaria) es un 404', async () => {
    const inquiries = { findById: jest.fn().mockResolvedValue(null) }

    await expect(
      new UpdatePublicInquiryStatusHandler(
        inquiries as never,
        {} as never,
      ).execute({ id: 'x', status: PublicInquiryStatus.CLOSED }),
    ).rejects.toBeInstanceOf(PublicInquiryNotFoundException)
  })
})
