import { Prisma } from '@prisma/client'

import { RequestContext } from '@/shared/context/request-context'
import { behaviourFor, DELETED_MARKER } from './auditable-models'

/** Operaciones de lectura a las que hay que sumarles el filtro de borrados. */
const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

/**
 * Bandera para saltearse el filtro en una consulta puntual.
 *
 * ```ts
 * prisma.user.findMany({ where: { [INCLUDE_DELETED]: true } })
 * ```
 */
export const INCLUDE_DELETED = Symbol('includeDeleted')

/** Marca el valor de un campo único como perteneciente a un registro borrado. */
export function markDeletedValue(value: string, id: string): string {
  return `${value}${DELETED_MARKER}${id}`
}

/** Recupera el valor original de un campo único marcado como borrado. */
export function unmarkDeletedValue(value: string): string {
  const index = value.indexOf(DELETED_MARKER)
  return index === -1 ? value : value.slice(0, index)
}

/**
 * Soft delete automático.
 *
 * Para los modelos configurados en `MODEL_BEHAVIOUR`:
 *
 * - `delete` y `deleteMany` pasan a marcar `deletedAt` en vez de borrar.
 * - Todas las lecturas filtran `deletedAt: null`.
 * - Los campos únicos declarados en `mutateOnDelete` se reescriben para liberar
 *   el índice.
 *
 * ## Límites que hay que conocer
 *
 * 1. **`$queryRaw` no pasa por acá** y ve los registros borrados. Si escribís
 *    SQL a mano, el filtro va a mano también.
 * 2. **Los `count` de relaciones anidadas incluyen borrados** salvo que filtres
 *    explícito en el `include`.
 * 3. **`findUnique` se convierte en `findFirst`.** Prisma no acepta filtros no
 *    únicos en un `findUnique`, así que no hay alternativa. En la práctica es
 *    equivalente, pero el plan de la consulta puede diferir.
 */
export function softDeleteExtension() {
  return Prisma.defineExtension({
    name: 'soft-delete',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const behaviour = behaviourFor(model)
          if (!behaviour.softDelete) return query(args)

          const params = args as Record<string, any>

          // --- Lecturas: filtrar los borrados -----------------------------
          if (READ_OPERATIONS.has(operation)) {
            return query(withNotDeleted(params))
          }

          // `findUnique` no admite filtros extra: se degrada a `findFirst`.
          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            const delegate = (this as any)[model as string]
            const fallback =
              operation === 'findUnique' ? 'findFirst' : 'findFirstOrThrow'

            return delegate[fallback](withNotDeleted(params))
          }

          // --- Borrados: marcar en vez de eliminar ------------------------
          if (operation === 'delete' || operation === 'deleteMany') {
            const delegate = (this as any)[model as string]
            const now = new Date()
            const deletedById = RequestContext.userId ?? null

            if (operation === 'delete') {
              // Se lee primero para poder mutar los campos únicos con el id.
              const current = await delegate.findFirst({
                where: params.where,
              })

              if (!current) {
                // Sin registro, dejamos que Prisma tire su propio P2025.
                return query(args)
              }

              return delegate.update({
                where: params.where,
                data: {
                  deletedAt: now,
                  deletedById,
                  ...mutatedUniqueFields(model, current),
                },
              })
            }

            return delegate.updateMany({
              where: { ...(params.where ?? {}), deletedAt: null },
              data: { deletedAt: now, deletedById },
            })
          }

          // --- Escrituras: que no pisen un registro borrado ----------------
          if (operation === 'update' || operation === 'updateMany') {
            return query(withNotDeleted(params))
          }

          return query(args)
        },
      },
    },
  })
}

/** Suma `deletedAt: null` al where, salvo que se pida lo contrario. */
function withNotDeleted(params: Record<string, any>): Record<string, any> {
  const where = params?.where ?? {}

  if (where[INCLUDE_DELETED]) {
    const { [INCLUDE_DELETED]: _omit, ...rest } = where
    return { ...params, where: rest }
  }

  // Si quien llama ya filtró por deletedAt, se respeta su criterio.
  if ('deletedAt' in where) return params

  return { ...params, where: { ...where, deletedAt: null } }
}

/**
 * Reescribe los campos únicos para liberar el índice.
 *
 * Ver el comentario de `mutateOnDelete` en auditable-models.ts para el porqué.
 */
function mutatedUniqueFields(
  model: string | undefined,
  current: Record<string, any>,
): Record<string, string> {
  const fields = behaviourFor(model).mutateOnDelete ?? []
  const output: Record<string, string> = {}

  for (const field of fields) {
    const value = current[field]
    if (typeof value === 'string' && !value.includes(DELETED_MARKER)) {
      output[field] = markDeletedValue(value, String(current.id))
    }
  }

  return output
}
