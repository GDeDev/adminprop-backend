import { Prisma } from '@prisma/client'

import { RequestContext } from '@/shared/context/request-context'
import { behaviourFor, delegateKey, DELETED_MARKER } from './auditable-models'

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
 * Filtro para incluir también los registros borrados en una consulta.
 *
 * ```ts
 * import { INCLUDE_DELETED } from '.../soft-delete.extension'
 *
 * await prisma.db.user.findMany({ where: { ...INCLUDE_DELETED, role: 'ADMIN' } })
 * ```
 *
 * Funciona porque la extensión respeta cualquier `deletedAt` que ya venga en el
 * `where`, y Prisma ignora las claves con valor `undefined`. El resultado es
 * una consulta sin ningún filtro sobre `deletedAt`.
 *
 * La primera versión de esto usaba un `Symbol` como clave, que es más prolijo
 * pero no funciona: Prisma serializa los argumentos al pasarlos entre
 * extensiones y las claves de tipo Symbol se pierden en el camino.
 */
export const INCLUDE_DELETED = { deletedAt: undefined } as const

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
/**
 * Referencia tardía al cliente ya extendido.
 *
 * Hace falta porque hay una circularidad real: la extensión necesita el cliente
 * completo, pero el cliente completo se construye aplicando la extensión. Se
 * resuelve pasando un contenedor vacío y llenándolo justo después.
 */
export interface ClientRef {
  /** Cliente base, sin extensiones. Para las lecturas internas. */
  base: Record<string, any>
  /** Cliente con todas las extensiones. Se asigna después de construirlo. */
  extended?: Record<string, any>
}

export function softDeleteExtension(ref: ClientRef) {
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

          const key = delegateKey(model as string)
          // Las lecturas internas van por el cliente base: ya les aplicamos el
          // filtro a mano y no queremos que vuelvan a entrar al pipeline.
          const baseDelegate = ref.base[key]
          // Las escrituras derivadas van por el cliente extendido, para que la
          // auditoría las vea. Un `delete` convertido en `update` que corriera
          // sobre el cliente base no quedaría registrado en el historial.
          const writeDelegate = (ref.extended ?? ref.base)[key]

          // `findUnique` no admite filtros extra: se degrada a `findFirst`.
          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            const fallback =
              operation === 'findUnique' ? 'findFirst' : 'findFirstOrThrow'

            return baseDelegate[fallback](withNotDeleted(params))
          }

          // --- Borrados: marcar en vez de eliminar ------------------------
          if (operation === 'delete' || operation === 'deleteMany') {
            const now = new Date()
            const deletedById = RequestContext.userId ?? null

            if (operation === 'delete') {
              // Se lee primero para poder mutar los campos únicos con el id.
              const current = await baseDelegate.findFirst({
                where: params.where,
              })

              if (!current) {
                // Sin registro, dejamos que Prisma tire su propio P2025.
                return query(args)
              }

              return writeDelegate.update({
                where: params.where,
                data: {
                  deletedAt: now,
                  deletedById,
                  ...mutatedUniqueFields(model, current),
                },
              })
            }

            return writeDelegate.updateMany({
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

/** Suma `deletedAt: null` al where, salvo que quien llama ya haya decidido. */
function withNotDeleted(params: Record<string, any>): Record<string, any> {
  const where = params?.where ?? {}

  // Si el where ya menciona `deletedAt` —con un valor o con `undefined`, que es
  // lo que hace INCLUDE_DELETED— mandan las instrucciones de quien llamó.
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
