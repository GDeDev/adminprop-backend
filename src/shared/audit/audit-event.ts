import { AuditAction, AuditActorKind, Prisma } from '@prisma/client'

import { RequestContext } from '@/shared/context/request-context'
import { createLogger } from '@/shared/logging/root-logger'

const logger = createLogger('AuditEvent')

/** Lo que hace falta para escribir una fila: el cliente base de Prisma. */
export interface AuditLogWriter {
  auditLog: { create: (args: any) => Promise<unknown> }
}

/**
 * Un evento de auditoría que no sale del diff automático de Prisma (Fase 20):
 * accesos, avisos enviados, jobs manuales, exportaciones. `changes` sigue la
 * misma forma que el diff, `{ campo: { after: valor } }`, así la pantalla los
 * muestra igual.
 */
export interface AuditEventInput {
  action: AuditAction
  entity: string
  entityId?: string | null
  summary?: string | null
  changes?: Record<string, unknown> | null
  /** Por defecto, el rol del contexto: `OWNER`/`RENTER` son portal, sin usuario es sistema. */
  actorKind?: AuditActorKind
  /** Por defecto, los del `RequestContext`. El login todavía no los tiene. */
  tenantId?: string | null
  userId?: string | null
  userEmail?: string | null
  ip?: string | null
}

/** Quién actúa según el rol del usuario; sin usuario es el sistema. */
export function actorKindOf(
  role: string | null | undefined,
  hasUser: boolean,
): AuditActorKind {
  if (!hasUser) return AuditActorKind.SYSTEM
  if (role === 'OWNER') return AuditActorKind.PORTAL_OWNER
  if (role === 'RENTER') return AuditActorKind.PORTAL_RENTER
  return AuditActorKind.USER
}

/** Arma `{ campo: { after } }` descartando lo indefinido. */
export function eventChanges(
  values: Record<string, unknown>,
): Record<string, { after: unknown }> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, { after: value }]),
  )
}

/**
 * Escribe el evento con el cliente base (sin filtro de tenant: la tabla admite
 * filas globales). Nunca propaga su error, igual que el diff automático: que
 * falle la auditoría no puede tumbar un login ni un envío.
 */
export async function writeAuditEvent(
  prisma: AuditLogWriter,
  input: AuditEventInput,
): Promise<void> {
  const context = RequestContext.get()
  const userId = input.userId !== undefined ? input.userId : context?.userId
  try {
    await prisma.auditLog.create({
      data: {
        tenantId:
          input.tenantId !== undefined
            ? input.tenantId
            : (context?.tenantId ?? null),
        entity: input.entity,
        entityId: input.entityId ?? null,
        action: input.action,
        summary: input.summary?.slice(0, 300) ?? null,
        changes: (input.changes ?? undefined) as
          Prisma.InputJsonValue | undefined,
        actorKind:
          input.actorKind ?? actorKindOf(context?.userRole, Boolean(userId)),
        userId: userId ?? null,
        userEmail:
          input.userEmail !== undefined
            ? input.userEmail
            : (context?.userEmail ?? null),
        correlationId: context?.correlationId ?? null,
        ip: input.ip !== undefined ? input.ip : (context?.ip ?? null),
      },
    })
  } catch (error) {
    logger.error(
      { err: error, entity: input.entity, action: input.action },
      'No se pudo registrar el evento de auditoría',
    )
  }
}
