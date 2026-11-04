import { INestApplication } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { Role } from '@prisma/client'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { NotificationDeliveryService } from '../src/modules/notifications/application/notification-delivery.service'
import { FlakyEmailAdapter } from '../src/platform/email/adapters/flaky.email-adapter'
import { EmailPort } from '../src/platform/email/email.port'
import { signSvix } from '../src/platform/email/svix-signature'
import {
  NotificationChannel,
  NotificationRecipientKind,
  NotificationRequest,
} from '../src/platform/notifications/notifications.port'
import { NotificationsService } from '../src/platform/notifications/notifications.service'
import { QueuePort } from '../src/platform/queue/queue.port'
import { StoragePort } from '../src/platform/storage/storage.port'
import { RequestContext } from '../src/shared/context/request-context'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { SETTLEMENT_CONFIRMED_QUEUE } from '../src/modules/settlements/public'
import { loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'
import { waitFor } from './utils/wait-for'

const WEBHOOK_SECRET = `whsec_${Buffer.from('secreto-de-prueba-e2e').toString('base64')}`

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

/** Notificaciones y mailing (Fase 14), contra Postgres y la cola real. */
describe('Notificaciones (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  const email = new FlakyEmailAdapter()
  let app: INestApplication
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let counter = 0

  const server = () => app.getHttpServer()
  const api = (token: string) => ({
    get: (url: string) =>
      request(server())
        .get(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
    post: (url: string) =>
      request(server())
        .post(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
    put: (url: string) =>
      request(server())
        .put(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
    delete: (url: string) =>
      request(server())
        .delete(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
  })

  const inTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
    RequestContext.run({ correlationId: 'test' }, () =>
      RequestContext.runInTenant(tenantId, fn),
    )

  const key = (name: string) => `${name}:${++counter}`

  /** Pide un aviso como lo haría un job. */
  const send = (
    overrides: Partial<NotificationRequest> & { tenant?: string } = {},
  ) => {
    const { tenant, ...rest } = overrides
    return app.get(NotificationsService).send({
      tenantId: tenant ?? tenantA.id,
      type: 'PAYMENT_REMINDER',
      recipient: {
        kind: NotificationRecipientKind.RENTER,
        id: UNKNOWN_ID,
        email: 'ivan@inquilino.com',
        phone: '1123456789',
      },
      dedupeKey: key('PAYMENT_REMINDER'),
      channels: [NotificationChannel.EMAIL, NotificationChannel.WHATSAPP_LINK],
      data: {
        renterName: 'Iván López',
        propertyAddress: 'Av. Corrientes 1234',
        period: '2026-11',
        amount: '125000.00',
        currency: 'ARS',
        lastDayWithoutLateFee: '2026-11-10',
      },
      ...rest,
    })
  }

  const rowOf = (dedupeKey: string) =>
    prisma.notificationLog.findFirstOrThrow({ where: { dedupeKey } })

  const deliver = (tenantId: string, id: string) =>
    inTenant(tenantId, () => app.get(NotificationDeliveryService).deliver(id))

  /** Espera a que el consumidor de la cola procese el primer intento. */
  const settle = async (dedupeKey: string) => {
    await waitFor(async () => {
      const row = await rowOf(dedupeKey)
      return row.status !== 'QUEUED' || row.attempts > 0
    })
    return rowOf(dedupeKey)
  }

  const sentTo = (to: string) => email.sent.filter((m) => m.to === to)

  beforeAll(async () => {
    await prisma.$connect()
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailPort)
      .useValue(email)
      .compile()
    app = moduleRef.createNestApplication<NestExpressApplication>()
    configureApp(app as NestExpressApplication)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
    email.sent.length = 0
    email.messageIds.length = 0
    email.failures = 0
    email.attempts = 0

    tenantA = await createTenant(prisma, 'tenant-a')
    tenantB = await createTenant(prisma, 'tenant-b')
    await prisma.tenant.update({
      where: { id: tenantA.id },
      data: { email: 'contacto@a.com', whatsapp: '+54 9 221 555-1234' },
    })
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'admin@a.com',
      role: Role.ADMIN,
    })
    await createUser(prisma, { tenantId: tenantA.id, email: 'emp@a.com' })
    await createUser(prisma, {
      tenantId: tenantB.id,
      email: 'admin@b.com',
      role: Role.ADMIN,
    })
    adminToken = await loginAs(app, 'admin@a.com')
    employeeToken = await loginAs(app, 'emp@a.com')
    adminBToken = await loginAs(app, 'admin@b.com')
  })

  describe('envío y historial', () => {
    it('arma el mail con la plantilla, lo entrega por la cola y lo deja en el historial', async () => {
      const dedupeKey = key('PAYMENT_REMINDER')
      expect(await send({ dedupeKey })).toBe('SENT')

      await waitFor(async () => (await rowOf(dedupeKey)).status === 'SENT')

      const [message] = sentTo('ivan@inquilino.com')
      expect(message.subject).toBe('Recordatorio de pago - 11/2026')
      expect(message.text).toContain('Hola Iván López')
      expect(message.text).toContain('$ 125.000,00')
      expect(message.text).toContain('10/11/2026')
      expect(message.html).toContain('<p ')
      expect(message.replyTo).toBe('contacto@a.com')
      expect(message.fromName).toBe('Inmobiliaria tenant-a')

      const row = await rowOf(dedupeKey)
      expect(row).toMatchObject({
        status: 'SENT',
        attempts: 1,
        templateKey: 'PAYMENT_REMINDER.EMAIL',
        subject: 'Recordatorio de pago - 11/2026',
      })
      expect(row.providerMessageId).toMatch(/^console_/)

      const list = await api(adminToken).get('/notifications').expect(200)
      expect(list.body.data.data).toHaveLength(1)
      expect(list.body.data.data[0]).toMatchObject({
        id: row.id,
        type: 'PAYMENT_REMINDER',
        status: 'SENT',
        recipientKind: 'RENTER',
        recipientLabel: 'Iván López',
        recipientEmail: 'ivan@inquilino.com',
        attempts: 1,
        deliveredAt: null,
      })

      const detail = await api(adminToken)
        .get(`/notifications/${row.id}`)
        .expect(200)
      expect(detail.body.data).toMatchObject({
        subject: 'Recordatorio de pago - 11/2026',
        canResend: false,
        events: [],
      })
      expect(detail.body.data.bodyText).toContain('Hola Iván López')
    })

    it('deja constancia en la auditoría del mail enviado (NOTIFICATION_SENT)', async () => {
      const dedupeKey = key('PAYMENT_REMINDER')
      await send({ dedupeKey })
      await waitFor(async () => (await rowOf(dedupeKey)).status === 'SENT')

      const audits = await prisma.auditLog.findMany({
        where: { action: 'NOTIFICATION_SENT', tenantId: tenantA.id },
      })
      expect(audits).toHaveLength(1)
      expect(audits[0].entityId).toBe((await rowOf(dedupeKey)).id)
    })

    it('el mismo dedupeKey no se manda dos veces', async () => {
      const dedupeKey = key('PAYMENT_REMINDER')
      expect(await send({ dedupeKey })).toBe('SENT')
      await waitFor(async () => (await rowOf(dedupeKey)).status === 'SENT')

      expect(await send({ dedupeKey })).toBe('SKIPPED')
      expect(await send({ dedupeKey })).toBe('SKIPPED')

      expect(sentTo('ivan@inquilino.com')).toHaveLength(1)
      expect(await prisma.notificationLog.count({ where: { dedupeKey } })).toBe(
        1,
      )
    })

    it('un lote con un inquilino sin email no se frena: esa fila queda SKIPPED y el resto sale', async () => {
      const keys = ['uno', 'dos', 'tres'].map((n) => key(`lote-${n}`))
      const outcomes = []
      for (const [index, dedupeKey] of keys.entries()) {
        outcomes.push(
          await send({
            dedupeKey,
            recipient: {
              kind: NotificationRecipientKind.RENTER,
              id: UNKNOWN_ID,
              email: index === 1 ? null : `inq${index}@x.com`,
              phone: '1123456789',
            },
          }),
        )
      }
      expect(outcomes).toEqual(['SENT', 'SKIPPED', 'SENT'])

      await waitFor(async () => email.sent.length === 2)
      const middle = await rowOf(keys[1])
      expect(middle).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'NO_RECIPIENT_EMAIL',
      })
      expect(sentTo('inq0@x.com')).toHaveLength(1)
      expect(sentTo('inq2@x.com')).toHaveLength(1)

      // Cuando se carga el email, la próxima corrida del job lo manda.
      expect(
        await send({
          dedupeKey: keys[1],
          recipient: {
            kind: NotificationRecipientKind.RENTER,
            id: UNKNOWN_ID,
            email: 'inq1@x.com',
          },
        }),
      ).toBe('SENT')
      await waitFor(async () => (await rowOf(keys[1])).status === 'SENT')
    })

    it('aísla el historial y el detalle entre inmobiliarias', async () => {
      const dedupeKey = key('PAYMENT_REMINDER')
      await send({ dedupeKey })
      const row = await rowOf(dedupeKey)

      const listB = await api(adminBToken).get('/notifications').expect(200)
      expect(listB.body.data.data).toHaveLength(0)
      const detail = await api(adminBToken)
        .get(`/notifications/${row.id}`)
        .expect(404)
      expect(detail.body.code).toBe('NOTIFICATION_NOT_FOUND')
      await api(adminBToken).post(`/notifications/${row.id}/resend`).expect(404)
    })

    it('filtra el historial y lo pagina, y exige ser admin', async () => {
      await send({ dedupeKey: key('PAYMENT_REMINDER') })
      await send({
        dedupeKey: key('SKIPPED'),
        recipient: { kind: NotificationRecipientKind.RENTER, email: null },
      })

      const skipped = await api(adminToken)
        .get('/notifications?status=SKIPPED')
        .expect(200)
      expect(skipped.body.data.data).toHaveLength(1)
      expect(skipped.body.data.data[0].skipReason).toBe('NO_RECIPIENT_EMAIL')

      const paged = await api(adminToken)
        .get('/notifications?limit=1&page=2')
        .expect(200)
      expect(paged.body.data.pagination).toMatchObject({ total: 2, page: 2 })

      await api(employeeToken).get('/notifications').expect(403)
      await api(employeeToken).get('/notifications/settings').expect(403)
    })
  })

  describe('preferencias y configuración', () => {
    it('lista el catálogo con el estado de la inmobiliaria', async () => {
      const settings = await api(adminToken)
        .get('/notifications/settings')
        .expect(200)

      const items = settings.body.data as {
        type: string
        enabled: boolean
        mandatory: boolean
        channels: string[]
        audience: string
      }[]
      expect(items).toHaveLength(23)
      expect(items.find((i) => i.type === 'PAYMENT_RECEIVED')).toMatchObject({
        enabled: false,
      })
      expect(items.find((i) => i.type === 'INSURER_ALERT')).toMatchObject({
        mandatory: true,
        enabled: true,
        audience: 'Aseguradora',
      })
      expect(
        items.find((i) => i.type === 'PAYMENT_REMINDER')?.channels,
      ).toEqual(['EMAIL', 'WHATSAPP_LINK'])
    })

    it('un tipo apagado por la inmobiliaria queda SKIPPED (TYPE_DISABLED) y se puede volver a prender', async () => {
      await api(adminToken)
        .put('/notifications/settings')
        .send({
          settings: [
            {
              type: 'PAYMENT_REMINDER',
              enabled: false,
              channels: ['EMAIL'],
            },
          ],
        })
        .expect(200)

      const dedupeKey = key('PAYMENT_REMINDER')
      expect(await send({ dedupeKey })).toBe('SKIPPED')
      expect(await rowOf(dedupeKey)).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'TYPE_DISABLED',
      })
      expect(email.sent).toHaveLength(0)

      await api(adminToken)
        .put('/notifications/settings')
        .send({
          settings: [
            { type: 'PAYMENT_REMINDER', enabled: true, channels: ['EMAIL'] },
          ],
        })
        .expect(200)
      expect(await send({ dedupeKey })).toBe('SENT')
    })

    it('un canal que la inmobiliaria sacó queda SKIPPED (CHANNEL_DISABLED)', async () => {
      await api(adminToken)
        .put('/notifications/settings')
        .send({
          settings: [
            {
              type: 'PAYMENT_REMINDER',
              enabled: true,
              channels: ['WHATSAPP_LINK'],
            },
          ],
        })
        .expect(200)
      const dedupeKey = key('PAYMENT_REMINDER')
      await send({ dedupeKey, channels: [NotificationChannel.EMAIL] })
      expect(await rowOf(dedupeKey)).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'CHANNEL_DISABLED',
      })
    })

    it('un tipo obligatorio no se puede deshabilitar (422) y los datos inválidos se rechazan', async () => {
      const response = await api(adminToken)
        .put('/notifications/settings')
        .send({
          settings: [
            { type: 'INSURER_ALERT', enabled: false, channels: ['EMAIL'] },
          ],
        })
        .expect(422)
      expect(response.body.code).toBe('NOTIFICATION_MANDATORY')

      await api(adminToken)
        .put('/notifications/settings')
        .send({
          settings: [
            { type: 'JOB_FAILED', enabled: true, channels: ['EMAIL'] },
          ],
        })
        .expect(422)
      await api(adminToken)
        .put('/notifications/settings')
        .send({ settings: [{ type: 'NADA', enabled: true, channels: [] }] })
        .expect(400)

      // Nada de lo anterior dejó rastro.
      expect(await prisma.notificationSetting.count()).toBe(0)
    })

    it('la configuración de una inmobiliaria no afecta a otra', async () => {
      await api(adminToken)
        .put('/notifications/settings')
        .send({
          settings: [
            { type: 'PAYMENT_REMINDER', enabled: false, channels: ['EMAIL'] },
          ],
        })
        .expect(200)

      const dedupeKey = key('PAYMENT_REMINDER')
      expect(await send({ dedupeKey, tenant: tenantB.id })).toBe('SENT')
      const b = await api(adminBToken)
        .get('/notifications/settings')
        .expect(200)
      expect(
        b.body.data.find((i: { type: string }) => i.type === 'PAYMENT_REMINDER')
          .enabled,
      ).toBe(true)
    })

    it('el personal recibe un mail por persona y el opt-out de uno no afecta al otro', async () => {
      const first = key('CONTRACT_EXPIRING')
      const request = (dedupeKey: string) => ({
        type: 'CONTRACT_EXPIRING' as const,
        recipient: { kind: NotificationRecipientKind.TENANT_STAFF },
        dedupeKey,
        channels: [NotificationChannel.EMAIL],
        data: { propertyAddress: 'Av. Corrientes 1234', endDate: '2026-12-01' },
      })

      expect(await send(request(first))).toBe('SENT')
      await waitFor(async () => email.sent.length === 2)
      expect(sentTo('admin@a.com')).toHaveLength(1)
      expect(sentTo('emp@a.com')).toHaveLength(1)
      expect(sentTo('admin@a.com')[0].text).toContain('Hola')

      // El empleado apaga el email de este tipo.
      const mine = await api(employeeToken)
        .get('/notifications/me/preferences')
        .expect(200)
      expect(mine.body.data.items).toHaveLength(23)
      await api(employeeToken)
        .put('/notifications/me/preferences')
        .send({
          items: [
            {
              type: 'CONTRACT_EXPIRING',
              emailEnabled: false,
              inAppEnabled: true,
            },
          ],
        })
        .expect(200)

      const second = key('CONTRACT_EXPIRING')
      await send(request(second))
      await waitFor(async () => email.sent.length === 3)
      expect(sentTo('admin@a.com')).toHaveLength(2)
      expect(sentTo('emp@a.com')).toHaveLength(1)

      const rows = await prisma.notificationLog.findMany({
        where: { dedupeKey: { startsWith: second } },
      })
      expect(rows.map((r) => r.status).sort()).toEqual(['SENT', 'SKIPPED'])
      expect(rows.find((r) => r.status === 'SKIPPED')?.skipReason).toBe(
        'USER_OPTED_OUT',
      )

      // El admin ve su preferencia intacta.
      const admin = await api(adminToken)
        .get('/notifications/me/preferences')
        .expect(200)
      expect(
        admin.body.data.items.find(
          (i: { type: string }) => i.type === 'CONTRACT_EXPIRING',
        ).emailEnabled,
      ).toBe(true)
    })

    it('las preferencias propias no pueden apagar un tipo obligatorio', async () => {
      const response = await api(employeeToken)
        .put('/notifications/me/preferences')
        .send({
          items: [
            {
              type: 'ARREARS_NOTICE',
              emailEnabled: false,
              inAppEnabled: true,
            },
          ],
        })
        .expect(422)
      expect(response.body.code).toBe('NOTIFICATION_MANDATORY')
    })

    it('el aviso interno de la campana se oculta sólo a quien lo apagó', async () => {
      const alerts = (token: string) =>
        api(token)
          .get('/automations/alerts')
          .expect(200)
          .then((r) => r.body.data.data as { type: string }[])

      await send({
        type: 'STATEMENT_PENDING',
        recipient: { kind: NotificationRecipientKind.TENANT_STAFF },
        dedupeKey: key('STATEMENT_PENDING'),
        channels: [NotificationChannel.IN_APP],
        data: { title: 'Consolidados pendientes', body: 'Hay 2', link: null },
      })
      expect(await alerts(employeeToken)).toHaveLength(1)

      await api(employeeToken)
        .put('/notifications/me/preferences')
        .send({
          items: [
            {
              type: 'STATEMENT_PENDING',
              emailEnabled: false,
              inAppEnabled: false,
            },
          ],
        })
        .expect(200)

      expect(await alerts(employeeToken)).toHaveLength(0)
      expect(await alerts(adminToken)).toHaveLength(1)
    })

    it('PAYMENT_RECEIVED viene apagado y ni siquiera manda mail', async () => {
      const dedupeKey = key('PAYMENT_RECEIVED')
      await send({
        type: 'PAYMENT_RECEIVED',
        dedupeKey,
        channels: [NotificationChannel.EMAIL],
      })
      expect(await rowOf(dedupeKey)).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'TYPE_DISABLED',
      })
      expect(email.sent).toHaveLength(0)
    })
  })

  describe('reintentos y reenvíos', () => {
    it('reintenta un error temporal con espera, sale al tercer intento y deja el rastro', async () => {
      email.failNext(2)
      const dedupeKey = key('PAYMENT_REMINDER')
      await send({ dedupeKey })

      const first = await settle(dedupeKey)
      expect(first).toMatchObject({ status: 'QUEUED', attempts: 1 })
      expect(first.error).toContain('Rate limit')
      // 1 minuto de espera hasta el próximo intento.
      const wait = first.nextAttemptAt!.getTime() - Date.now()
      expect(wait).toBeGreaterThan(40_000)
      expect(wait).toBeLessThanOrEqual(60_000)

      expect(await deliver(tenantA.id, first.id)).toBe('QUEUED')
      const second = await rowOf(dedupeKey)
      expect(second.attempts).toBe(2)
      // 5 minutos después del segundo.
      expect(second.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(
        4 * 60_000,
      )

      expect(await deliver(tenantA.id, first.id)).toBe('SENT')
      expect(await rowOf(dedupeKey)).toMatchObject({
        status: 'SENT',
        attempts: 3,
        error: null,
        nextAttemptAt: null,
      })
      expect(sentTo('ivan@inquilino.com')).toHaveLength(1)
    })

    it('agota los cuatro intentos de un aviso crítico y avisa al personal (NOTIFICATION_FAILED)', async () => {
      email.failNext(99)
      const dedupeKey = key('INSURER_ALERT')
      await send({
        type: 'INSURER_ALERT',
        dedupeKey,
        recipient: {
          kind: NotificationRecipientKind.INSURER,
          email: 'alertas@finaer.com',
        },
        channels: [NotificationChannel.EMAIL],
        data: { insurerName: 'Finaer', policyNumber: 'POL-1' },
      })
      const first = await settle(dedupeKey)

      expect(await deliver(tenantA.id, first.id)).toBe('QUEUED')
      expect(await deliver(tenantA.id, first.id)).toBe('QUEUED')
      expect(await deliver(tenantA.id, first.id)).toBe('FAILED')

      const failed = await rowOf(dedupeKey)
      expect(failed).toMatchObject({
        status: 'FAILED',
        attempts: 4,
        nextAttemptAt: null,
      })
      expect(failed.error).toContain('Rate limit')
      // Un mensaje repetido de la cola no revive una fila cerrada.
      expect(await deliver(tenantA.id, first.id)).toBe('FAILED')
      expect(email.attempts).toBe(4)

      const alerts = await api(adminToken)
        .get('/automations/alerts')
        .expect(200)
      const alert = alerts.body.data.data.find(
        (a: { type: string }) => a.type === 'NOTIFICATION_FAILED',
      )
      expect(alert).toBeDefined()
      expect(alert.body).toContain('alertas@finaer.com')
      expect(alert.entityId).toBe(failed.id)

      const item = await api(adminToken)
        .get(`/notifications/${failed.id}`)
        .expect(200)
      expect(item.body.data).toMatchObject({ canResend: true, attempts: 4 })
    })

    it('un aviso no crítico que falla queda en el historial sin avisar a la campana', async () => {
      email.failNext(99)
      const dedupeKey = key('PAYMENT_REMINDER')
      await send({ dedupeKey })
      const first = await settle(dedupeKey)
      await deliver(tenantA.id, first.id)
      await deliver(tenantA.id, first.id)
      expect(await deliver(tenantA.id, first.id)).toBe('FAILED')

      const alerts = await api(adminToken)
        .get('/automations/alerts')
        .expect(200)
      expect(alerts.body.data.data).toHaveLength(0)
    })

    it('un error definitivo (dirección inválida) no se reintenta', async () => {
      email.failNext(1, { retryable: false })
      const dedupeKey = key('PAYMENT_REMINDER')
      await send({ dedupeKey })

      const row = await settle(dedupeKey)
      expect(row).toMatchObject({ status: 'FAILED', attempts: 1 })
      expect(row.error).toContain('Dirección inválida')
    })

    it('el reenvío manual vuelve a encolar con los intentos en cero, se audita y no repite lo ya enviado', async () => {
      email.failNext(1, { retryable: false })
      const dedupeKey = key('PAYMENT_REMINDER')
      await send({ dedupeKey })
      const failed = await settle(dedupeKey)

      const response = await api(adminToken)
        .post(`/notifications/${failed.id}/resend`)
        .expect(200)
      expect(response.body.data).toMatchObject({ id: failed.id, attempts: 0 })

      await waitFor(async () => (await rowOf(dedupeKey)).status === 'SENT')
      expect(await rowOf(dedupeKey)).toMatchObject({ attempts: 1, error: null })
      expect(
        await prisma.auditLog.count({
          where: { action: 'NOTIFICATION_SENT', entityId: failed.id },
        }),
      ).toBeGreaterThanOrEqual(2)

      const again = await api(adminToken)
        .post(`/notifications/${failed.id}/resend`)
        .expect(409)
      expect(again.body.code).toBe('NOTIFICATION_NOT_RESENDABLE')
      expect(sentTo('ivan@inquilino.com')).toHaveLength(1)
    })

    it('"reintentar todas las fallidas" es un AsyncJob que se consulta en /jobs/:id/status', async () => {
      email.failNext(2, { retryable: false })
      const keys = [key('PAYMENT_REMINDER'), key('PAYMENT_REMINDER')]
      for (const dedupeKey of keys) {
        await send({ dedupeKey })
        await settle(dedupeKey)
      }
      expect(
        await prisma.notificationLog.count({ where: { status: 'FAILED' } }),
      ).toBe(2)

      const response = await api(adminToken)
        .post('/notifications/resend-failed')
        .send({ type: 'PAYMENT_REMINDER' })
        .expect(202)
      const jobId = response.body.data.jobId as string

      await waitFor(async () => {
        const status = await api(adminToken).get(`/jobs/${jobId}/status`)
        return status.body.data?.status === 'COMPLETED'
      })
      const status = await api(adminToken).get(`/jobs/${jobId}/status`)
      expect(status.body.data).toMatchObject({
        type: 'notifications-resend-failed',
        totalItems: 2,
        processedItems: 2,
        failedItems: 0,
        progress: 100,
      })
      expect(
        await prisma.notificationLog.count({ where: { status: 'SENT' } }),
      ).toBe(2)

      // Otra inmobiliaria no ve el trabajo.
      await api(adminBToken).get(`/jobs/${jobId}/status`).expect(404)
      await api(employeeToken).post('/notifications/resend-failed').expect(403)
    })
  })

  describe('adjuntos', () => {
    const uploadPdf = async (kind: 'SETTLEMENT', entityId: string) => {
      const content = Buffer.from('%PDF-1.4 contenido de prueba')
      const stored = await inTenant(tenantA.id, () =>
        app
          .get(StoragePort)
          .upload(content, `documents/settlement/${entityId}-1.pdf`),
      )
      await prisma.generatedDocument.create({
        data: {
          tenantId: tenantA.id,
          kind,
          entityId,
          version: 1,
          status: 'READY',
          storageKey: stored.key,
          url: stored.url,
          sizeBytes: content.length,
          generatedAt: new Date(),
        },
      })
      return content
    }

    it('adjunta el PDF de la liquidación al mail del propietario', async () => {
      const settlementId = '11111111-1111-4111-8111-111111111111'
      const content = await uploadPdf('SETTLEMENT', settlementId)
      const dedupeKey = key('SETTLEMENT_CONFIRMED')

      await send({
        type: 'SETTLEMENT_CONFIRMED',
        dedupeKey,
        recipient: {
          kind: NotificationRecipientKind.OWNER,
          email: 'juan@propietario.com',
        },
        entity: { type: 'SETTLEMENT', id: settlementId },
        channels: [NotificationChannel.EMAIL],
        data: {
          recipientName: 'Juan Pérez',
          propertyAddress: 'Av. Corrientes 1234',
          period: '2026-10',
          amount: '250000.00',
          currency: 'ARS',
        },
      })
      await waitFor(async () => (await rowOf(dedupeKey)).status === 'SENT')

      const [message] = sentTo('juan@propietario.com')
      expect(message.subject).toBe(
        'Liquidación de 10/2026 - Av. Corrientes 1234',
      )
      expect(message.text).toContain('$ 250.000,00')
      expect(message.attachments).toHaveLength(1)
      expect(message.attachments![0]).toMatchObject({
        filename: 'liquidacion.pdf',
        contentType: 'application/pdf',
      })
      expect(message.attachments![0].content.equals(content)).toBe(true)
    })

    it('si el PDF no está listo espera tres veces y después sale sin adjunto', async () => {
      const dedupeKey = key('SETTLEMENT_CONFIRMED')
      await send({
        type: 'SETTLEMENT_CONFIRMED',
        dedupeKey,
        recipient: {
          kind: NotificationRecipientKind.OWNER,
          email: 'juan@propietario.com',
        },
        entity: {
          type: 'SETTLEMENT',
          id: '22222222-2222-4222-8222-222222222222',
        },
        channels: [NotificationChannel.EMAIL],
        data: { recipientName: 'Juan Pérez', period: '2026-10' },
      })
      // El primer intento (de la cola) ya cuenta como una espera.
      await waitFor(
        async () =>
          ((await rowOf(dedupeKey)).payload as Record<string, unknown>)?.[
            'attachmentWaits'
          ] === 1,
      )
      const { id } = await rowOf(dedupeKey)

      expect(await deliver(tenantA.id, id)).toBe('QUEUED')
      expect(await deliver(tenantA.id, id)).toBe('QUEUED')
      expect(email.sent).toHaveLength(0)
      expect(await deliver(tenantA.id, id)).toBe('SENT')

      expect(email.sent).toHaveLength(1)
      expect(email.sent[0].attachments).toBeUndefined()
    })

    it('un aviso de otra inmobiliaria no adjunta el PDF ajeno', async () => {
      const settlementId = '33333333-3333-4333-8333-333333333333'
      await uploadPdf('SETTLEMENT', settlementId)
      const dedupeKey = key('SETTLEMENT_CONFIRMED')

      await send({
        tenant: tenantB.id,
        type: 'SETTLEMENT_CONFIRMED',
        dedupeKey,
        recipient: {
          kind: NotificationRecipientKind.OWNER,
          email: 'otro@propietario.com',
        },
        entity: { type: 'SETTLEMENT', id: settlementId },
        channels: [NotificationChannel.EMAIL],
        data: { period: '2026-10' },
      })
      await waitFor(
        async () =>
          ((await rowOf(dedupeKey)).payload as Record<string, unknown>)?.[
            'attachmentWaits'
          ] === 1,
      )
      expect(email.sent).toHaveLength(0)
    })
  })

  describe('eventos de dominio', () => {
    it('liquidación confirmada: encola el mail al propietario con los datos del evento', async () => {
      const owner = await api(adminToken)
        .post('/owners')
        .send({
          firstName: 'Juan',
          lastName: 'Pérez',
          nationalId: '30111222',
          email: 'juan@propietario.com',
          bankAccount: { cbu: '0110599552000000123456' },
        })
        .expect(201)
      const settlementId = '44444444-4444-4444-8444-444444444444'

      await inTenant(tenantA.id, () =>
        app.get(QueuePort).publish(SETTLEMENT_CONFIRMED_QUEUE, {
          settlementId,
          ownerId: owner.body.data.id,
          contractId: UNKNOWN_ID,
          period: '2026-10',
          netAmount: '250000.00',
          currency: 'ARS',
        }),
      )

      await waitFor(
        async () =>
          (await prisma.notificationLog.count({
            where: { dedupeKey: `SETTLEMENT_CONFIRMED:${settlementId}` },
          })) === 1,
      )
      const row = await rowOf(`SETTLEMENT_CONFIRMED:${settlementId}`)
      expect(row).toMatchObject({
        type: 'SETTLEMENT_CONFIRMED',
        recipientKind: 'OWNER',
        recipientEmail: 'juan@propietario.com',
        entityType: 'SETTLEMENT',
        entityId: settlementId,
        subject: expect.stringContaining('10/2026'),
      })
    })
  })

  describe('plantillas', () => {
    it('lista las plantillas por defecto con sus variables', async () => {
      const response = await api(adminToken)
        .get('/notifications/templates')
        .expect(200)

      const templates = response.body.data as {
        key: string
        type: string
        channel: string
        isCustomized: boolean
        variables: { name: string; label: string; example: string }[]
      }[]
      expect(templates.length).toBeGreaterThanOrEqual(10)
      expect(templates.every((t) => !t.isCustomized)).toBe(true)
      const reminder = templates.find(
        (t) => t.key === 'PAYMENT_REMINDER.EMAIL',
      )!
      expect(reminder).toMatchObject({
        type: 'PAYMENT_REMINDER',
        channel: 'EMAIL',
      })
      expect(reminder.variables.map((v) => v.name)).toEqual(
        expect.arrayContaining(['recipientName', 'amount', 'dueDate']),
      )
      expect(reminder.variables[0].example).toBeTruthy()
    })

    it('edita, usa y restaura una plantilla; rechaza variables desconocidas', async () => {
      const bad = await api(adminToken)
        .put('/notifications/templates/PAYMENT_REMINDER.EMAIL')
        .send({ subject: 'Hola {{inventada}}', bodyText: 'Texto' })
        .expect(422)
      expect(bad.body.code).toBe('TEMPLATE_UNKNOWN_VARIABLE')
      await api(adminToken)
        .put('/notifications/templates/NO_EXISTE.EMAIL')
        .send({ subject: 'a', bodyText: 'b' })
        .expect(404)

      const saved = await api(adminToken)
        .put('/notifications/templates/PAYMENT_REMINDER.EMAIL')
        .send({
          subject: 'Tu cuota de {{period}}',
          bodyText: 'Hola {{recipientName}}, debés {{amount}}.',
        })
        .expect(200)
      expect(saved.body.data).toMatchObject({
        isCustomized: true,
        subject: 'Tu cuota de {{period}}',
      })
      expect(saved.body.data.updatedAt).toBeTruthy()

      const dedupeKey = key('PAYMENT_REMINDER')
      await send({ dedupeKey })
      await waitFor(async () => (await rowOf(dedupeKey)).status === 'SENT')
      expect(sentTo('ivan@inquilino.com')[0]).toMatchObject({
        subject: 'Tu cuota de 11/2026',
        text: 'Hola Iván López, debés $ 125.000,00.',
      })

      // Otra inmobiliaria sigue con el texto original.
      const other = await api(adminBToken)
        .get('/notifications/templates')
        .expect(200)
      expect(
        other.body.data.find(
          (t: { key: string }) => t.key === 'PAYMENT_REMINDER.EMAIL',
        ).isCustomized,
      ).toBe(false)

      const restored = await api(adminToken)
        .delete('/notifications/templates/PAYMENT_REMINDER.EMAIL')
        .expect(200)
      expect(restored.body.data.isCustomized).toBe(false)
      expect(restored.body.data.subject).toBe(
        'Recordatorio de pago - {{period}}',
      )

      // El cambio quedó en el historial de auditoría.
      expect(
        await prisma.auditLog.count({
          where: { entity: 'NotificationTemplate', tenantId: tenantA.id },
        }),
      ).toBeGreaterThanOrEqual(2)
    })

    it('la vista previa renderiza con datos de ejemplo y escapa el HTML', async () => {
      const response = await api(adminToken)
        .post('/notifications/templates/PAYMENT_REMINDER.EMAIL/preview')
        .send({
          subject: 'Cuota {{period}}',
          bodyText: '<b>Hola</b> {{recipientName}}\n\nDebés {{amount}}',
        })
        .expect(200)

      expect(response.body.data.subject).toBe('Cuota 11/2026')
      expect(response.body.data.text).toContain('Ana Gómez')
      expect(response.body.data.html).toContain('&lt;b&gt;Hola&lt;/b&gt;')
      expect(response.body.data.html).toContain('Inmobiliaria tenant-a')
      expect(email.sent).toHaveLength(0)
    })

    it('"enviarme una prueba" manda la plantilla al email del usuario por el mismo camino', async () => {
      const response = await api(adminToken)
        .post('/notifications/templates/PAYMENT_REMINDER.EMAIL/test')
        .expect(200)

      expect(response.body.data).toEqual({ sentTo: 'admin@a.com' })
      const [message] = sentTo('admin@a.com')
      expect(message.subject).toContain('[Prueba]')
      expect(message.text).toContain('Ana Gómez')
      expect(
        await prisma.notificationLog.count({ where: { status: 'SENT' } }),
      ).toBe(1)
    })

    it('el empleado no edita plantillas pero sí lee las de WhatsApp', async () => {
      await api(employeeToken).get('/notifications/templates').expect(403)
      await api(employeeToken)
        .put('/notifications/templates/PAYMENT_REMINDER.EMAIL')
        .send({ subject: 'a', bodyText: 'b' })
        .expect(403)

      const whatsapp = await api(employeeToken)
        .get('/notifications/whatsapp-templates')
        .expect(200)
      const keys = whatsapp.body.data.map((t: { key: string }) => t.key)
      expect(keys).toEqual(
        expect.arrayContaining([
          'PAYMENT_REMINDER',
          'ARREARS',
          'INQUIRY_FIRST_CONTACT',
        ]),
      )
      await api(employeeToken).get('/notifications/me/preferences').expect(200)
    })
  })

  describe('plantillas de WhatsApp', () => {
    it('edita una plantilla y la restringe a sus variables; es por inmobiliaria', async () => {
      const saved = await api(adminToken)
        .put('/notifications/whatsapp-templates/INQUIRY_FIRST_CONTACT')
        .send({ body: 'Hola {{recipientName}}, soy de {{agencyName}}.' })
        .expect(200)
      expect(saved.body.data).toMatchObject({
        key: 'INQUIRY_FIRST_CONTACT',
        isCustomized: true,
      })

      const bad = await api(adminToken)
        .put('/notifications/whatsapp-templates/INQUIRY_FIRST_CONTACT')
        .send({ body: 'Hola {{nada}}' })
        .expect(422)
      expect(bad.body.code).toBe('TEMPLATE_UNKNOWN_VARIABLE')
      await api(adminToken)
        .put('/notifications/whatsapp-templates/NO_EXISTE')
        .send({ body: 'x' })
        .expect(404)

      const mine = await api(employeeToken)
        .get('/notifications/whatsapp-templates')
        .expect(200)
      expect(
        mine.body.data.find(
          (t: { key: string }) => t.key === 'INQUIRY_FIRST_CONTACT',
        ),
      ).toMatchObject({
        body: 'Hola {{recipientName}}, soy de {{agencyName}}.',
        isCustomized: true,
      })

      const other = await api(adminBToken)
        .get('/notifications/whatsapp-templates')
        .expect(200)
      expect(
        other.body.data.find(
          (t: { key: string }) => t.key === 'INQUIRY_FIRST_CONTACT',
        ).isCustomized,
      ).toBe(false)
    })
  })

  describe('webhook de Resend', () => {
    let notificationId: string
    let providerMessageId: string

    beforeEach(async () => {
      const dedupeKey = key('PAYMENT_REMINDER')
      await send({ dedupeKey })
      await waitFor(async () => (await rowOf(dedupeKey)).status === 'SENT')
      const row = await rowOf(dedupeKey)
      notificationId = row.id
      providerMessageId = row.providerMessageId!
    })

    const post = (
      body: unknown,
      options: {
        secret?: string
        timestamp?: string
        id?: string
        tamper?: boolean
        signature?: string
      } = {},
    ) => {
      const raw = JSON.stringify(body)
      const id = options.id ?? `msg_${++counter}`
      const timestamp =
        options.timestamp ?? String(Math.floor(Date.now() / 1000))
      const signature =
        options.signature ??
        signSvix(options.secret ?? WEBHOOK_SECRET, id, timestamp, raw)
      return request(server())
        .post('/api/v1/webhooks/resend')
        .set({
          'content-type': 'application/json',
          'svix-id': id,
          'svix-timestamp': timestamp,
          'svix-signature': signature,
        })
        .send(options.tamper ? raw.replace('email', 'em4il') : raw)
    }

    const AT: Record<string, string> = {
      'email.delivered': '2026-11-03T15:00:00.000Z',
      'email.opened': '2026-11-03T15:05:00.000Z',
    }
    const event = (type: string, to = 'ivan@inquilino.com') => ({
      type,
      created_at: AT[type] ?? '2026-11-03T15:30:00.000Z',
      data: { email_id: providerMessageId, to: [to] },
    })

    it('guarda entregas y aperturas y las muestra en el detalle', async () => {
      await post(event('email.delivered')).expect(200)
      await post(event('email.opened')).expect(200)

      const detail = await api(adminToken)
        .get(`/notifications/${notificationId}`)
        .expect(200)
      expect(
        detail.body.data.events.map((e: { type: string }) => e.type),
      ).toEqual(['DELIVERED', 'OPENED'])
      expect(detail.body.data.deliveredAt).toBe('2026-11-03T15:00:00.000Z')
      expect(detail.body.data.openedAt).toBe('2026-11-03T15:05:00.000Z')
      expect(detail.body.data.bouncedAt).toBeNull()
    })

    it('un evento repetido no duplica nada', async () => {
      const first = await post(event('email.delivered')).expect(200)
      const second = await post(event('email.delivered')).expect(200)

      expect(first.body.data.recorded).toBe(true)
      expect(second.body.data.recorded).toBe(false)
      expect(await prisma.emailEvent.count()).toBe(1)
    })

    it('un rebote avisa al personal una sola vez', async () => {
      await post(event('email.bounced')).expect(200)
      await post(event('email.complained')).expect(200)

      const alerts = await api(adminToken)
        .get('/automations/alerts')
        .expect(200)
      const bounced = alerts.body.data.data.filter(
        (a: { type: string }) => a.type === 'EMAIL_BOUNCED',
      )
      expect(bounced).toHaveLength(1)
      expect(bounced[0].body).toContain('ivan@inquilino.com')

      const list = await api(adminToken).get('/notifications').expect(200)
      expect(list.body.data.data[0].bouncedAt).toBeTruthy()
    })

    it('rechaza una firma inválida, un cuerpo alterado y un timestamp vencido', async () => {
      await post(event('email.delivered'), {
        secret: `whsec_${Buffer.from('otro-secreto').toString('base64')}`,
      }).expect(401)
      await post(event('email.delivered'), { tamper: true }).expect(401)
      await post(event('email.delivered'), {
        timestamp: String(Math.floor(Date.now() / 1000) - 10 * 60),
      }).expect(401)
      await post(event('email.delivered'), { signature: 'v1,AAAA' }).expect(401)
      await request(server())
        .post('/api/v1/webhooks/resend')
        .send(event('email.delivered'))
        .expect(401)

      expect(await prisma.emailEvent.count()).toBe(0)
    })

    it('descarta un evento de un mensaje desconocido y uno de un tipo que no usamos', async () => {
      const unknown = await post({
        type: 'email.delivered',
        data: { email_id: 'no-existe', to: ['x@y.com'] },
      }).expect(200)
      const other = await post(event('email.received')).expect(200)

      expect(unknown.body.data.recorded).toBe(false)
      expect(other.body.data.recorded).toBe(false)
      expect(await prisma.emailEvent.count()).toBe(0)
    })

    it('el evento simulado de desarrollo funciona con el adapter de consola y sólo para el admin', async () => {
      await api(adminToken)
        .post('/notifications/dev/events')
        .send({ notificationId, type: 'OPENED' })
        .expect(200)
      const detail = await api(adminToken)
        .get(`/notifications/${notificationId}`)
        .expect(200)
      expect(detail.body.data.openedAt).toBeTruthy()

      await api(employeeToken)
        .post('/notifications/dev/events')
        .send({ notificationId, type: 'OPENED' })
        .expect(403)
      await api(adminBToken)
        .post('/notifications/dev/events')
        .send({ notificationId, type: 'OPENED' })
        .expect(404)
    })
  })
})
