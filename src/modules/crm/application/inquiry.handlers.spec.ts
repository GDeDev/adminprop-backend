import { RequestContext } from '@/shared/context/request-context'
import {
  AssigneeInvalidException,
  InquiryContactRequiredException,
  InquiryNotFoundException,
  InvalidBoardNeighbourException,
  LostReasonRequiredException,
} from '../domain/crm.exceptions'
import { Inquiry, InquirySource, InquiryStage } from '../domain/inquiry'
import {
  AssignInquiryCommand,
  MoveInquiryCommand,
  RecordContactAttemptCommand,
} from './crm.messages'
import { InquiryRegistrar } from './inquiry-registrar'
import {
  AssignInquiryHandler,
  MoveInquiryHandler,
  RecordContactAttemptHandler,
} from './inquiry.handlers'

const BASE: Inquiry = {
  id: 'i1',
  name: 'Ana',
  email: 'ana@mail.com',
  phone: null,
  message: 'Hola',
  propertyId: null,
  source: InquirySource.PORTAL,
  stage: InquiryStage.NEW,
  stageChangedAt: new Date('2026-11-01T00:00:00Z'),
  boardPosition: 1000,
  assignedToId: null,
  nextActionAt: null,
  lastContactAt: null,
  lostReason: null,
  closedAt: null,
  contractId: null,
  externalId: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
}

function repos(current: Inquiry | null = BASE) {
  const inquiries = {
    findById: jest.fn().mockResolvedValue(current),
    update: jest
      .fn()
      .mockImplementation(async (_id: string, patch: object) => ({
        ...(current ?? BASE),
        ...patch,
      })),
    columnPositions: jest.fn().mockResolvedValue([]),
    setPositions: jest.fn().mockResolvedValue(undefined),
    minPosition: jest.fn().mockResolvedValue(null),
  }
  const activities = { add: jest.fn().mockResolvedValue({}) }
  const views = { card: jest.fn().mockImplementation(async (x) => x) }
  return { inquiries, activities, views }
}

describe('MoveInquiryHandler', () => {
  const build = (r: ReturnType<typeof repos>, contractExists = true) =>
    new MoveInquiryHandler(
      r.inquiries as never,
      r.activities as never,
      r.views as never,
      { exists: jest.fn().mockResolvedValue(contractExists) } as never,
    )

  // Antes se guardaba cualquier contractId, también el de otra inmobiliaria.
  it('un contrato inexistente o de otro tenant es CONTRACT_NOT_FOUND', async () => {
    const r = repos()
    await expect(
      build(r, false).execute(
        new MoveInquiryCommand('x', {
          stage: InquiryStage.CLOSED_WON,
          contractId: 'c-ajeno',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONTRACT_NOT_FOUND' })
    expect(r.inquiries.update).not.toHaveBeenCalled()
  })

  it('una consulta inexistente (o de otro tenant) es INQUIRY_NOT_FOUND', async () => {
    const r = repos(null)
    await expect(
      build(r).execute(
        new MoveInquiryCommand('x', { stage: InquiryStage.CONTACTED }),
      ),
    ).rejects.toBeInstanceOf(InquiryNotFoundException)
  })

  it('CLOSED_LOST sin motivo es un 422 y no toca nada', async () => {
    const r = repos()
    await expect(
      build(r).execute(
        new MoveInquiryCommand('i1', { stage: InquiryStage.CLOSED_LOST }),
      ),
    ).rejects.toBeInstanceOf(LostReasonRequiredException)
    expect(r.inquiries.update).not.toHaveBeenCalled()
  })

  it('cambia de columna, fija el primer contacto y deja la actividad', async () => {
    const r = repos()
    r.inquiries.columnPositions.mockResolvedValue([
      { id: 'a', boardPosition: 1000 },
      { id: 'b', boardPosition: 2000 },
    ])
    const card = await build(r).execute(
      new MoveInquiryCommand('i1', {
        stage: InquiryStage.CONTACTED,
        afterId: 'b',
        beforeId: 'a',
      }),
    )
    expect(card).toMatchObject({
      stage: InquiryStage.CONTACTED,
      boardPosition: 1500,
    })
    expect(card.lastContactAt).toBeInstanceOf(Date)
    expect(r.activities.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'STAGE_CHANGED',
        payload: { from: 'NEW', to: 'CONTACTED' },
      }),
    )
  })

  it('sin vecinos va arriba de la columna de destino', async () => {
    const r = repos()
    r.inquiries.columnPositions.mockResolvedValue([
      { id: 'a', boardPosition: 1000 },
    ])
    const card = await build(r).execute(
      new MoveInquiryCommand('i1', { stage: InquiryStage.CONTACTED }),
    )
    expect(card.boardPosition).toBe(0)
  })

  it('un vecino que no es de esa columna se rechaza', async () => {
    const r = repos()
    await expect(
      build(r).execute(
        new MoveInquiryCommand('i1', {
          stage: InquiryStage.CONTACTED,
          beforeId: 'otra-columna',
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidBoardNeighbourException)
  })

  it('con vecinos sin lugar renumera la columna y calcula de nuevo', async () => {
    const r = repos()
    r.inquiries.columnPositions.mockResolvedValue([
      { id: 'a', boardPosition: 1 },
      { id: 'b', boardPosition: 1 + 1e-9 },
    ])
    const card = await build(r).execute(
      new MoveInquiryCommand('i1', {
        stage: InquiryStage.CONTACTED,
        beforeId: 'a',
        afterId: 'b',
      }),
    )
    expect(r.inquiries.setPositions).toHaveBeenCalledWith([
      { id: 'a', boardPosition: 1000 },
      { id: 'b', boardPosition: 2000 },
    ])
    expect(card.boardPosition).toBe(1500)
  })

  it('reordenar dentro de la misma columna no deja actividad de cambio de etapa', async () => {
    const r = repos()
    r.inquiries.columnPositions.mockResolvedValue([
      { id: 'a', boardPosition: 1000 },
    ])
    await build(r).execute(
      new MoveInquiryCommand('i1', {
        stage: InquiryStage.NEW,
        beforeId: 'a',
      }),
    )
    expect(r.activities.add).not.toHaveBeenCalled()
  })

  it('reabrir una cerrada limpia el cierre', async () => {
    const lost = {
      ...BASE,
      stage: InquiryStage.CLOSED_LOST,
      lostReason: 'Precio',
      closedAt: new Date(),
    }
    const r = repos(lost)
    const card = await build(r).execute(
      new MoveInquiryCommand('i1', { stage: InquiryStage.CONTACTED }),
    )
    expect(card).toMatchObject({ closedAt: null, lostReason: null })
  })
})

describe('AssignInquiryHandler', () => {
  it('asignar a alguien que no es personal activo del tenant es ASSIGNEE_INVALID', async () => {
    const r = repos()
    const users = {
      listStaffContacts: jest.fn().mockResolvedValue([{ userId: 'u1' }]),
    }
    const registrar = new InquiryRegistrar(
      r.inquiries as never,
      r.activities as never,
      users as never,
    )
    const handler = new AssignInquiryHandler(
      r.inquiries as never,
      r.activities as never,
      registrar,
      { assigned: jest.fn() } as never,
      r.views as never,
    )
    await expect(
      handler.execute(new AssignInquiryCommand('i1', 'otro-tenant')),
    ).rejects.toBeInstanceOf(AssigneeInvalidException)
    expect(r.inquiries.update).not.toHaveBeenCalled()

    await handler.execute(new AssignInquiryCommand('i1', 'u1'))
    expect(r.inquiries.update).toHaveBeenCalledWith('i1', {
      assignedToId: 'u1',
    })
    expect(r.activities.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ASSIGNED',
        payload: { from: null, to: 'u1' },
      }),
    )
  })
})

describe('RecordContactAttemptHandler', () => {
  it('el primer contacto pasa NEW a CONTACTED y fija el último contacto', async () => {
    const r = repos()
    const handler = new RecordContactAttemptHandler(
      r.inquiries as never,
      r.activities as never,
      r.views as never,
    )
    const card = await handler.execute(
      new RecordContactAttemptCommand('i1', 'WHATSAPP' as never),
    )
    expect(card.stage).toBe(InquiryStage.CONTACTED)
    expect(card.lastContactAt).toBeInstanceOf(Date)
    expect(r.activities.add).toHaveBeenCalledTimes(2)
  })
})

describe('InquiryRegistrar', () => {
  const build = (
    r: ReturnType<typeof repos>,
    existing: Inquiry | null = null,
  ) => {
    const inquiries = {
      ...r.inquiries,
      findByExternalId: jest.fn().mockResolvedValue(existing),
      create: jest
        .fn()
        .mockImplementation(async (data: object) => ({ ...BASE, ...data })),
    }
    return {
      inquiries,
      registrar: new InquiryRegistrar(
        inquiries as never,
        r.activities as never,
        { listStaffContacts: jest.fn().mockResolvedValue([]) } as never,
      ),
    }
  }

  it('exige email o teléfono', async () => {
    const { registrar } = build(repos())
    await expect(
      registrar.register({ name: 'Ana', source: InquirySource.MANUAL }),
    ).rejects.toBeInstanceOf(InquiryContactRequiredException)
  })

  it('normaliza, entra arriba de NEW y deja la actividad CREATED', async () => {
    const r = repos()
    r.inquiries.minPosition.mockResolvedValue(3000)
    const { registrar, inquiries } = build(r)
    const { inquiry, created } = await RequestContext.runInTenant('t1', () =>
      registrar.register({
        name: '  Ana   Pérez ',
        email: 'ANA@Mail.com',
        source: InquirySource.PORTAL,
      }),
    )
    expect(created).toBe(true)
    expect(inquiries.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ana Pérez',
        email: 'ana@mail.com',
        boardPosition: 2000,
      }),
    )
    expect(inquiry.stage).toBe(InquiryStage.NEW)
    expect(r.activities.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CREATED' }),
    )
  })

  it('no duplica una consulta con el mismo id externo', async () => {
    const existing = { ...BASE, id: 'ya-estaba' }
    const { registrar, inquiries } = build(repos(), existing)
    const result = await registrar.register({
      name: 'Ana',
      email: 'a@b.com',
      source: InquirySource.MERCADOLIBRE,
      externalId: 'ML-1',
    })
    expect(result).toEqual({ inquiry: existing, created: false })
    expect(inquiries.create).not.toHaveBeenCalled()
  })
})
