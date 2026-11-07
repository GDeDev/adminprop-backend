import { AuditAction, AuditActorKind } from '@prisma/client'

import { RequestContext } from '@/shared/context/request-context'
import { actorKindOf, eventChanges, writeAuditEvent } from './audit-event'

describe('audit-event', () => {
  it('deduce el actor del rol', () => {
    expect(actorKindOf('ADMIN', true)).toBe(AuditActorKind.USER)
    expect(actorKindOf('EMPLOYEE', true)).toBe(AuditActorKind.USER)
    expect(actorKindOf('OWNER', true)).toBe(AuditActorKind.PORTAL_OWNER)
    expect(actorKindOf('RENTER', true)).toBe(AuditActorKind.PORTAL_RENTER)
    expect(actorKindOf('ADMIN', false)).toBe(AuditActorKind.SYSTEM)
  })

  it('arma los cambios con la forma del diff y descarta lo indefinido', () => {
    expect(eventChanges({ a: 1, b: undefined, c: null })).toEqual({
      a: { after: 1 },
      c: { after: null },
    })
  })

  it('toma tenant, usuario e ip del contexto y deja que el llamador los pise', async () => {
    const create = jest.fn().mockResolvedValue({})
    await RequestContext.run(
      {
        correlationId: 'c1',
        tenantId: 't1',
        userId: 'u1',
        userEmail: 'a@b.com',
        userRole: 'OWNER',
        ip: '1.1.1.1',
      },
      () =>
        writeAuditEvent(
          { auditLog: { create } },
          { action: AuditAction.EXPORT, entity: 'Report', summary: 'x' },
        ),
    )
    expect(create.mock.calls[0][0].data).toMatchObject({
      tenantId: 't1',
      userId: 'u1',
      actorKind: AuditActorKind.PORTAL_OWNER,
      ip: '1.1.1.1',
      correlationId: 'c1',
      entityId: null,
    })

    await writeAuditEvent(
      { auditLog: { create } },
      {
        action: AuditAction.LOGIN_FAILED,
        entity: 'User',
        tenantId: null,
        userId: null,
      },
    )
    expect(create.mock.calls[1][0].data).toMatchObject({
      tenantId: null,
      userId: null,
      actorKind: AuditActorKind.SYSTEM,
    })
  })

  it('no propaga el error de la base', async () => {
    const create = jest.fn().mockRejectedValue(new Error('boom'))
    await expect(
      writeAuditEvent(
        { auditLog: { create } },
        { action: AuditAction.LOGIN, entity: 'User' },
      ),
    ).resolves.toBeUndefined()
  })
})
