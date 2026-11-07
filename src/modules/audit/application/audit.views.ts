import { Injectable } from '@nestjs/common'

import { UsersFacade } from '@/modules/auth/public'
import {
  AUDIT_ENTITY_LABELS,
  AuditAction,
  AuditActorKind,
  AuditRecord,
} from '../domain/audit'
import {
  AuditNameResolver,
  EntityRef,
  isUuid,
  REFERENCE_FIELDS,
  refKey,
} from './audit-name-resolver'
import { AuditSummarizer } from './audit-summarizer'

/** Contrato fijado por el frontend (`shared-types/audit.ts`). */
export interface AuditEntryView {
  id: string
  entity: string
  entityId: string | null
  action: AuditAction
  summary: string
  actorKind: AuditActorKind
  userId: string | null
  userEmail: string | null
  userName: string | null
  ip: string | null
  createdAt: Date
}

export interface AuditChangeView {
  field: string
  before: unknown
  after: unknown
  beforeLabel: string | null
  afterLabel: string | null
}

export interface AuditEntryDetailView extends AuditEntryView {
  changes: AuditChangeView[]
}

export interface AuditCatalogView {
  entities: string[]
  actions: AuditAction[]
}

export const AUDIT_ACTIONS: AuditAction[] = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'NOTIFICATION_SENT',
  'JOB_RUN',
  'EXPORT',
]

/** Arma lo que devuelve la API: la fila + frase + nombre del usuario. */
@Injectable()
export class AuditViews {
  constructor(
    private readonly summarizer: AuditSummarizer,
    private readonly names: AuditNameResolver,
    private readonly users: UsersFacade,
  ) {}

  async entries(records: AuditRecord[]): Promise<AuditEntryView[]> {
    const [summaries, users] = await Promise.all([
      this.summarizer.summarize(records),
      this.users.describe(records.flatMap((r) => (r.userId ? [r.userId] : []))),
    ])
    return records.map((record) => ({
      id: record.id,
      entity: record.entity,
      entityId: record.entityId,
      action: record.action,
      summary: summaries.get(record.id) ?? '',
      actorKind: record.actorKind,
      userId: record.userId,
      userEmail: record.userEmail,
      userName: record.userId
        ? (users.get(record.userId)?.fullName ?? null)
        : null,
      ip: record.ip,
      createdAt: record.createdAt,
    }))
  }

  async detail(record: AuditRecord): Promise<AuditEntryDetailView> {
    const [entry] = await this.entries([record])
    const fields = Object.entries(record.changes ?? {})

    const refs: EntityRef[] = []
    for (const [field, change] of fields) {
      const entity = REFERENCE_FIELDS[field]
      if (!entity) continue
      for (const value of [change.before, change.after]) {
        if (isUuid(value)) refs.push({ entity, id: value })
      }
    }
    const names = await this.names.resolve(refs)
    const label = (field: string, value: unknown): string | null => {
      const entity = REFERENCE_FIELDS[field]
      return entity && isUuid(value)
        ? (names.get(refKey(entity, value)) ?? null)
        : null
    }

    return {
      ...entry,
      changes: fields.map(([field, change]) => ({
        field,
        before: change.before ?? null,
        after: change.after ?? null,
        beforeLabel: label(field, change.before),
        afterLabel: label(field, change.after),
      })),
    }
  }

  catalog(stored: string[]): AuditCatalogView {
    return {
      entities: [
        ...new Set([...Object.keys(AUDIT_ENTITY_LABELS), ...stored]),
      ].sort(),
      actions: AUDIT_ACTIONS,
    }
  }
}
