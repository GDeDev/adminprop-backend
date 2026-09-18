/**
 * Configuración por modelo de la auditoría y el soft delete.
 *
 * Opt-in a propósito: un modelo sólo entra si está acá. Muchas tablas —tokens,
 * colas, cachés— no quieren ninguna de las dos cosas, y aplicarlas por defecto
 * llenaría el historial de ruido.
 */
export interface ModelBehaviour {
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
   * En MySQL **no sirve** un unique compuesto `(email, deletedAt)`: los índices
   * únicos tratan cada NULL como distinto, así que dos usuarios activos —ambos
   * con `deletedAt = NULL`— pasarían el constraint. Sería peor que no tenerlo.
   *
   * Por eso, al borrar se reescribe el valor como
   * `ana@ejemplo.com#deleted#<id>`: el índice queda honesto y el email se
   * libera para volver a usarse. El valor original queda en el historial.
   */
  mutateOnDelete?: string[]
}

export const MODEL_BEHAVIOUR: Record<string, ModelBehaviour> = {
  User: {
    audit: true,
    softDelete: true,
    excludeFromDiff: ['passwordHash', 'failedLoginAttempts', 'lastLoginAt'],
    mutateOnDelete: ['email'],
  },

  // Los refresh tokens no se auditan ni se borran lógicamente: son efímeros,
  // se rotan constantemente y el cron los borra de verdad a los 30 días.
  // Auditarlos generaría una fila de historial por cada refresh.
  RefreshToken: { audit: false, softDelete: false },

  // La propia tabla de auditoría no se audita: sería recursión infinita.
  AuditLog: { audit: false, softDelete: false },
}

const DEFAULT_BEHAVIOUR: ModelBehaviour = { audit: false, softDelete: false }

export function behaviourFor(model: string | undefined): ModelBehaviour {
  if (!model) return DEFAULT_BEHAVIOUR
  return MODEL_BEHAVIOUR[model] ?? DEFAULT_BEHAVIOUR
}

/** Sufijo con el que se marcan los valores únicos de un registro borrado. */
export const DELETED_MARKER = '#deleted#'
