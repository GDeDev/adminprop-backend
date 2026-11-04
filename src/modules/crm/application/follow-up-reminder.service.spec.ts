import { RequestContext } from '@/shared/context/request-context'
import { Inquiry, InquirySource, InquiryStage } from '../domain/inquiry'
import { FollowUpReminderService } from './follow-up-reminder.service'

const inquiry = (over: Partial<Inquiry>): Inquiry => ({
  id: 'i1',
  name: 'Ana',
  email: 'ana@mail.com',
  phone: null,
  message: '',
  propertyId: null,
  source: InquirySource.PORTAL,
  stage: InquiryStage.CONTACTED,
  stageChangedAt: new Date(),
  boardPosition: 1000,
  assignedToId: null,
  nextActionAt: '2026-11-05',
  lastContactAt: null,
  lostReason: null,
  closedAt: null,
  contractId: null,
  externalId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

describe('FollowUpReminderService', () => {
  const build = (due: Inquiry[], outcome: 'SENT' | 'SKIPPED' = 'SENT') => {
    const inquiries = { listFollowUpsDue: jest.fn().mockResolvedValue(due) }
    const notifications = { notifyStaff: jest.fn().mockResolvedValue(outcome) }
    const properties = {
      describe: jest
        .fn()
        .mockResolvedValue(new Map([['p1', { id: 'p1', address: 'Calle 1' }]])),
    }
    const users = {
      describe: jest
        .fn()
        .mockResolvedValue(new Map([['u1', { id: 'u1', fullName: 'Lucía' }]])),
    }
    const service = new FollowUpReminderService(
      inquiries as never,
      notifications as never,
      properties as never,
      users as never,
    )
    return {
      notifications,
      run: () =>
        RequestContext.runInTenant('t1', () => service.run('2026-11-05')),
    }
  }

  it('sin consultas vencidas no avisa nada', async () => {
    const { run, notifications } = build([])
    await expect(run()).resolves.toEqual({ due: 0, notified: 0, failed: 0 })
    expect(notifications.notifyStaff).not.toHaveBeenCalled()
  })

  it('avisa una vez por consulta y fecha de seguimiento, nombrando al responsable', async () => {
    const { run, notifications } = build([
      inquiry({ assignedToId: 'u1', propertyId: 'p1' }),
      inquiry({ id: 'i2', name: 'Beto' }),
    ])
    await expect(run()).resolves.toEqual({ due: 2, notified: 2, failed: 0 })
    expect(notifications.notifyStaff).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'INQUIRY_FOLLOW_UP',
        dedupeKey: 'INQUIRY_FOLLOW_UP:i1:2026-11-05',
        body: expect.stringContaining('Lucía'),
      }),
    )
    expect(notifications.notifyStaff).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.stringContaining('no tiene responsable'),
      }),
    )
  })

  it('es idempotente: un aviso ya enviado (SKIPPED) no cuenta como nuevo', async () => {
    const { run } = build([inquiry({})], 'SKIPPED')
    await expect(run()).resolves.toEqual({ due: 1, notified: 0, failed: 0 })
  })
})
