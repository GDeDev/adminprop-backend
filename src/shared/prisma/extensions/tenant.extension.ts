import { Prisma } from '@prisma/client'

import { RequestContext } from '@/shared/context/request-context'
import { behaviourFor } from './auditable-models'

/** Operaciones que filtran por `where`: se les suma el tenant. */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
])

/** Operaciones que insertan: se les completa el `tenantId` en `data`. */
const CREATE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
])

/**
 * Se consultó un modelo con tenant sin tenant en el contexto.
 *
 * Es siempre un bug de quien llama, nunca un error del usuario: por eso no es
 * una `AppException` y termina en un 500. Se falla cerrado a propósito; correr
 * la consulta sin filtro sería exponer los datos de todas las inmobiliarias.
 */
export class TenantContextMissingError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model}.${operation} sin tenant en el contexto. Dentro de un request ` +
        `lo fija JwtAuthGuard; fuera de uno, envolvé la llamada en ` +
        `RequestContext.runInTenant(), o usá prisma.unscoped si la consulta ` +
        `es a propósito entre tenants.`,
    )
    this.name = 'TenantContextMissingError'
  }
}

/** La consulta pidió explícitamente otro tenant distinto al del contexto. */
export class TenantMismatchError extends Error {
  constructor(model: string, operation: string) {
    super(`${model}.${operation} con un tenantId distinto al del contexto`)
    this.name = 'TenantMismatchError'
  }
}

/**
 * Aislamiento entre inmobiliarias (spec Fase 1, sección 3.2).
 *
 * Para los modelos con `tenantScoped: true` en `MODEL_BEHAVIOUR`:
 *
 * - Toda lectura, actualización y borrado suma `tenantId` al `where`. Un id de
 *   otro tenant se comporta igual que un id inexistente: `null`, `P2025`, y de
 *   ahí un 404, sin revelar que el registro existe.
 * - Todo alta completa `tenantId` con el del contexto.
 *
 * Tiene que ser la **primera** extensión aplicada: Prisma corre las extensiones
 * en el orden en que se encadenan, y así el soft delete y la auditoría —que
 * hacen lecturas internas con el cliente base— ya reciben el `where` filtrado.
 *
 * Límites: `$queryRaw` no pasa por acá (el filtro va a mano), y las relaciones
 * anidadas en un `include` no se filtran, porque se llega a ellas desde un
 * registro que ya es del tenant.
 */
export function tenantExtension() {
  return Prisma.defineExtension({
    name: 'tenant',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!behaviourFor(model).tenantScoped) return query(args)

          const tenantId = RequestContext.tenantId
          if (!tenantId) throw new TenantContextMissingError(model, operation)

          const params = { ...(args as Record<string, any>) }

          if (WHERE_OPERATIONS.has(operation)) {
            params.where = scopedWhere(params.where, tenantId, model, operation)
          } else if (CREATE_OPERATIONS.has(operation)) {
            params.data = Array.isArray(params.data)
              ? params.data.map((row: Record<string, any>) =>
                  scopedData(row, tenantId, model, operation),
                )
              : scopedData(params.data, tenantId, model, operation)
          } else if (operation === 'upsert') {
            params.where = scopedWhere(params.where, tenantId, model, operation)
            params.create = scopedData(
              params.create,
              tenantId,
              model,
              operation,
            )
          }

          return query(params)
        },
      },
    },
  })
}

function scopedWhere(
  where: Record<string, any> | undefined,
  tenantId: string,
  model: string,
  operation: string,
): Record<string, any> {
  const current = where ?? {}
  assertSameTenant(current.tenantId, tenantId, model, operation)
  return { ...current, tenantId }
}

function scopedData(
  data: Record<string, any> | undefined,
  tenantId: string,
  model: string,
  operation: string,
): Record<string, any> {
  const current = data ?? {}
  // Con la relación (`tenant: { connect }`) no se puede mezclar el campo
  // escalar, y dejarla pasar permitiría colgar el registro de otro tenant.
  if ('tenant' in current) throw new TenantMismatchError(model, operation)
  assertSameTenant(current.tenantId, tenantId, model, operation)
  return { ...current, tenantId }
}

function assertSameTenant(
  requested: unknown,
  tenantId: string,
  model: string,
  operation: string,
): void {
  if (requested !== undefined && requested !== tenantId) {
    throw new TenantMismatchError(model, operation)
  }
}
