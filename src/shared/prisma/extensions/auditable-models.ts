/**
 * Configuración por modelo del filtro de tenant, la auditoría y el soft delete.
 *
 * Opt-in a propósito: un modelo sólo entra si está acá. Muchas tablas —tokens,
 * colas, cachés— no quieren auditoría ni soft delete, y aplicarlos por defecto
 * llenaría el historial de ruido.
 *
 * **Todo modelo nuevo con columna `tenantId` se declara acá con
 * `tenantScoped: true`.** El test de `tenant-scoped-models.spec.ts` lo verifica
 * contra el schema: un modelo con `tenantId` que no esté declarado rompe el CI.
 */
export interface ModelBehaviour {
  /**
   * Filtrar todas las consultas por el tenant del contexto y completar
   * `tenantId` en las altas. Sin tenant en el contexto, la consulta falla.
   */
  tenantScoped?: boolean

  /** Registrar cada create/update/delete en `audit_logs`. */
  audit: boolean

  /**
   * Convertir los `delete` en marcar `deletedAt`, y filtrar los borrados de
   * todas las consultas. El modelo tiene que tener la columna `deletedAt`.
   */
  softDelete: boolean

  /**
   * Campos que nunca van al diff del historial, ni siquiera redactados.
   *
   * `passwordHash` es el caso obvio: guardar su "antes y después" en una tabla
   * de auditoría sería filtrar material para crackear offline.
   */
  excludeFromDiff?: string[]

  /**
   * Campos con índice único que hay que mutar al borrar lógicamente.
   *
   * **No sirve** un unique compuesto `(email, deletedAt)`: los índices únicos
   * tratan cada NULL como distinto, así que dos usuarios activos —ambos con
   * `deletedAt = NULL`— pasarían el constraint. El índice parcial de Postgres
   * (`WHERE deleted_at IS NULL`) lo resolvería, pero Prisma no lo puede declarar
   * en el schema.
   *
   * Por eso, al borrar se reescribe el valor como
   * `ana@ejemplo.com#deleted#<id>`: el índice queda honesto y el email se
   * libera para volver a usarse. El valor original queda en el historial.
   */
  mutateOnDelete?: string[]
}

export const MODEL_BEHAVIOUR: Record<string, ModelBehaviour> = {
  // La raíz del modelo multi-tenant: no tiene tenantId, es el tenant. Sin
  // auditoría por ahora: se crea por seed y no hay ABM; cuando se puedan editar
  // sus parámetros, sumarle las columnas createdById/updatedById y auditarlo.
  Tenant: { audit: false, softDelete: false },

  User: {
    tenantScoped: true,
    audit: true,
    softDelete: true,
    excludeFromDiff: ['passwordHash', 'failedLoginAttempts', 'lastLoginAt'],
    mutateOnDelete: ['email'],
  },

  // Trabajos en background: se actualizan en cada ítem procesado. Auditarlos
  // llenaría el historial de filas sin valor; el propio registro ya es la traza.
  AsyncJob: { tenantScoped: true, audit: false, softDelete: false },

  // Módulo de referencia: el patrón completo, con historial y borrado lógico.
  // El nombre es único por tenant: se muta al borrar para liberarlo.
  ExampleItem: {
    tenantScoped: true,
    audit: true,
    softDelete: true,
    mutateOnDelete: ['name'],
  },
  ExampleActivity: { tenantScoped: true, audit: false, softDelete: false },

  // Los refresh tokens no se auditan ni se borran lógicamente: son efímeros,
  // se rotan constantemente y el cron los borra de verdad a los 30 días.
  // Auditarlos generaría una fila de historial por cada refresh.
  RefreshToken: { audit: false, softDelete: false },

  // La propia tabla de auditoría no se audita: sería recursión infinita.
  // Guarda el tenantId de cada cambio, pero no se filtra todavía: la escribe la
  // extensión de auditoría también desde procesos sin tenant. Su lectura por
  // tenant llega con la pantalla de auditoría (Fase 20).
  AuditLog: { audit: false, softDelete: false },
}

const DEFAULT_BEHAVIOUR: ModelBehaviour = { audit: false, softDelete: false }

export function behaviourFor(model: string | undefined): ModelBehaviour {
  if (!model) return DEFAULT_BEHAVIOUR
  return MODEL_BEHAVIOUR[model] ?? DEFAULT_BEHAVIOUR
}

/** Sufijo con el que se marcan los valores únicos de un registro borrado. */
export const DELETED_MARKER = '#deleted#'

/**
 * Traduce el nombre del modelo al de su delegate en el cliente.
 *
 * Las extensiones reciben el modelo como lo declara el schema (`User`,
 * `AuditLog`), pero en el cliente los delegates están en camelCase
 * (`prisma.user`, `prisma.auditLog`). Acceder con el nombre sin convertir
 * devuelve `undefined`, y el error recién aparece una llamada después con un
 * "Cannot read properties of undefined".
 */
export function delegateKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1)
}
