import { Prisma } from '@prisma/client'

import { RequestContext } from '@/shared/context/request-context'
import { createLogger } from '@/shared/logging/root-logger'
import { behaviourFor, delegateKey } from './auditable-models'

const logger = createLogger('Audit')

/** Campos que nunca aportan nada al historial. */
const ALWAYS_EXCLUDED = ['updatedAt', 'createdAt', 'updatedById', 'createdById']

export interface FieldChange {
  antes: unknown
  despues: unknown
}

export type AuditDiff = Record<string, FieldChange>

/**
 * Historial de cambios automático.
 *
 * Para los modelos marcados con `audit: true`, escribe una fila en `audit_logs`
 * por cada create, update o delete, con **sólo los campos que cambiaron**.
 *
 * También completa `createdById` y `updatedById` leyendo el usuario del
 * `RequestContext`, así ningún repositorio tiene que acordarse de setearlos.
 *
 * ## Costo
 *
 * Un `update` auditado hace una lectura extra para conocer el estado previo y
 * poder calcular el diff. Es el precio de tener el "antes y después"; si sólo
 * te importa quién tocó el registro, alcanza con `createdById`/`updatedById` y
 * se puede poner `audit: false`.
 *
 * ## Por qué no falla la operación si falla la auditoría
 *
 * El registro del historial se escribe después de que la operación principal
 * salió bien, y su error se loguea sin propagarse: que se caiga la auditoría no
 * puede hacer fallar un alta que el usuario ya dio por hecha. La contrapartida
 * es que el historial puede tener huecos — quedan visibles en los logs.
 *
 * Sí se espera a que termine () en vez de dispararla y olvidarla: sin
 * eso, una lectura inmediatamente posterior puede no ver todavía la fila, y en
 * un script de vida corta el proceso puede terminar antes de que se escriba.
 */
export function auditExtension(client: {
  auditLog: { create: (args: any) => Promise<unknown> }
  [key: string]: any
}) {
  return Prisma.defineExtension({
    name: 'audit',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const behaviour = behaviourFor(model)
          if (!behaviour.audit) return query(args)

          const params = args as Record<string, any>
          const userId = RequestContext.userId ?? null

          // ---------------------------------------------------------- CREATE
          if (operation === 'create') {
            const data = { ...(params.data ?? {}) }
            if (userId && !('createdById' in data)) {
              data.createdById = userId
              data.updatedById = userId
            }

            const created = (await query({ ...params, data })) as Record<
              string,
              any
            >

            await record(client, model, 'CREATE', created?.id, {
              diff: onlyDefined(pick(created, behaviour.excludeFromDiff)),
              direction: 'despues',
            })

            return created
          }

          // ---------------------------------------------------------- UPDATE
          if (operation === 'update') {
            const delegate = client[delegateKey(model as string)]
            const before = (await delegate.findFirst({
              where: params.where,
            })) as Record<string, any> | null

            const data = { ...(params.data ?? {}) }
            if (userId && !('updatedById' in data)) data.updatedById = userId

            const after = (await query({ ...params, data })) as Record<
              string,
              any
            >

            // Un soft delete llega acá como update: se registra como DELETE.
            const isSoftDelete =
              before?.deletedAt === null && after?.deletedAt !== null

            const diff = buildDiff(before, after, behaviour.excludeFromDiff)
            if (Object.keys(diff).length > 0) {
              await record(
                client,
                model,
                isSoftDelete ? 'DELETE' : 'UPDATE',
                after?.id,
                { diff },
              )
            }

            return after
          }

          // ---------------------------------------------------------- DELETE
          // Sólo llega acá el borrado físico; el lógico pasa por `update`.
          if (operation === 'delete') {
            const deleted = (await query(args)) as Record<string, any>

            await record(client, model, 'DELETE', deleted?.id, {
              diff: onlyDefined(pick(deleted, behaviour.excludeFromDiff)),
              direction: 'antes',
            })

            return deleted
          }

          return query(args)
        },
      },
    },
  })
}

/** Campos cambiados entre dos estados, con su valor anterior y el nuevo. */
export function buildDiff(
  before: Record<string, any> | null,
  after: Record<string, any> | null,
  excluded: string[] = [],
): AuditDiff {
  if (!before || !after) return {}

  const skip = new Set([...ALWAYS_EXCLUDED, ...excluded])
  const diff: AuditDiff = {}

  for (const key of Object.keys(after)) {
    if (skip.has(key)) continue
    if (isEqual(before[key], after[key])) continue

    diff[key] = {
      antes: normalize(before[key]),
      despues: normalize(after[key]),
    }
  }

  return diff
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a === b) return true

  // Cubre Decimal de Prisma, BigInt y objetos simples.
  if (
    a != null &&
    b != null &&
    typeof a === 'object' &&
    typeof b === 'object'
  ) {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  return false
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  return value
}

function pick(
  source: Record<string, any> | null,
  excluded: string[] = [],
): Record<string, unknown> {
  if (!source) return {}

  const skip = new Set([...ALWAYS_EXCLUDED, ...excluded])
  const output: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(source)) {
    if (skip.has(key)) continue
    output[key] = normalize(value)
  }

  return output
}

function onlyDefined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  )
}

/** Escribe la fila de historial. Nunca propaga su error. */
async function record(
  prisma: { auditLog: { create: (args: any) => Promise<unknown> } },
  model: string | undefined,
  accion: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE',
  entidadId: unknown,
  options: {
    diff?: Record<string, unknown> | AuditDiff
    direction?: 'antes' | 'despues'
  },
): Promise<void> {
  if (!model || entidadId == null) return

  const context = RequestContext.get()

  const cambios = options.direction
    ? Object.fromEntries(
        Object.entries(options.diff ?? {}).map(([key, value]) => [
          key,
          { [options.direction as string]: value },
        ]),
      )
    : (options.diff ?? {})

  try {
    await prisma.auditLog.create({
      data: {
        entidad: model,
        entidadId: String(entidadId),
        accion,
        cambios: cambios as Prisma.InputJsonValue,
        usuarioId: context?.userId ?? null,
        usuarioEmail: context?.userEmail ?? null,
        correlationId: context?.correlationId ?? null,
        ip: context?.ip ?? null,
      },
    })
  } catch (error) {
    // Que falle el historial no puede tumbar la operación del usuario.
    logger.error(
      { err: error, entidad: model, entidadId: String(entidadId), accion },
      'No se pudo registrar el cambio en el historial',
    )
  }
}
