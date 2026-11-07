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
  // La raíz del modelo multi-tenant: no tiene tenantId, es el tenant. Se crea
  // por seed; desde la Fase 15 el admin edita sus datos legales y de marca, y
  // esos cambios quedan en el historial (createdById/updatedById).
  Tenant: { audit: true, softDelete: false },

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

  // Maestros (Fase 5): por inmobiliaria, con historial. Sin soft delete: se
  // desactivan con `isActive` y nunca se borran (el endpoint no existe).
  Location: { tenantScoped: true, audit: true, softDelete: false },
  PropertyType: { tenantScoped: true, audit: true, softDelete: false },
  Amenity: { tenantScoped: true, audit: true, softDelete: false },
  OperationType: { tenantScoped: true, audit: true, softDelete: false },
  ServiceType: { tenantScoped: true, audit: true, softDelete: false },

  // Propiedades (Fase 6): historial y borrado lógico. Las fotos no se auditan
  // una por una: el alta y la baja de cada foto ya queda en su propia fila.
  Property: { tenantScoped: true, audit: true, softDelete: true },
  PropertyPhoto: { tenantScoped: true, audit: false, softDelete: false },

  // Propietarios (Fase 7): historial (incluido cada cambio de CBU) y borrado
  // lógico. El DNI se libera con un índice parcial, no mutándolo.
  Owner: { tenantScoped: true, audit: true, softDelete: true },

  // Inquilinos y garantes (Fase 8): historial (incluido cada cambio de
  // garante, que es sensible) y borrado lógico. El DNI se libera con un
  // índice parcial, como en propietarios.
  Renter: { tenantScoped: true, audit: true, softDelete: true },
  Guarantor: { tenantScoped: true, audit: true, softDelete: true },

  // Índices ICL/IPC (Fase 9): datos públicos, iguales para todas las
  // inmobiliarias, así que no llevan tenant (D-54). Sin auditoría: la fila
  // misma dice de dónde salió y cuándo, y nunca se edita ni se borra.
  IndexValue: { tenantScoped: false, audit: false, softDelete: false },

  // Contratos (Fase 9): historial de cada cambio (notas, caución, garante,
  // estado), sin borrado lógico porque no se borran nunca. Cada aumento del
  // alquiler es su propia fila en el historial del canon: no se audita aparte.
  Contract: { tenantScoped: true, audit: true, softDelete: false },
  ContractRentUpdate: { tenantScoped: true, audit: false, softDelete: false },
  // Los términos de cobro son vigencias que nunca se pisan (D-70); se auditan
  // porque cambian plata (honorarios, punitorio) y quién cobra.
  ContractBillingTerms: { tenantScoped: true, audit: true, softDelete: false },

  // Servicios y gastos adelantados (Fase 10): historial y borrado lógico. Un
  // gasto adelantado es plata que se le descuenta a un tercero: cada cambio
  // y cada baja quedan en el historial.
  PropertyService: { tenantScoped: true, audit: true, softDelete: true },
  AdvanceExpense: { tenantScoped: true, audit: true, softDelete: true },

  // Inventario (Fase 25): el acta tiene historial; sus ítems y fotos se
  // reemplazan en bloque mientras es borrador, así que no se auditan ni se
  // borran lógicamente. Confirmado es inmutable (sin borrado lógico).
  PropertyInventory: { tenantScoped: true, audit: true, softDelete: false },
  InventoryItem: { tenantScoped: true, audit: false, softDelete: false },
  InventoryPhoto: { tenantScoped: true, audit: false, softDelete: false },

  // Sitio web de la inmobiliaria: los cambios de template, subdominio, dominio,
  // publicar y despublicar quedan en el historial por sus columnas. El
  // contenido (`draft`, `published`) es un JSON grande que cambia con cada
  // guardado: se excluye del diff para no llenar el historial. Las imágenes
  // subidas no se auditan (la fila misma es la traza).
  SiteSettings: {
    tenantScoped: true,
    audit: true,
    softDelete: false,
    excludeFromDiff: ['draft', 'published'],
  },
  SiteAsset: { tenantScoped: true, audit: false, softDelete: false },

  // Consultas (Fase 22 las crea el público, sin usuario; Fase 23 las administra
  // el CRM): cada cambio queda en el historial. La IP es sólo para frenar spam:
  // no va al historial. `externalId` se muta al borrar para liberar el único.
  PublicInquiry: {
    tenantScoped: true,
    audit: true,
    softDelete: true,
    excludeFromDiff: ['ip'],
    mutateOnDelete: ['externalId'],
  },
  // CRM (Fase 23): la línea de tiempo es inmutable y es su propia traza; las
  // vistas son un contador sin dato personal. Los canales y las publicaciones
  // tienen historial; los tokens cifrados nunca van al diff.
  InquiryActivity: { tenantScoped: true, audit: false, softDelete: false },
  PropertyView: { tenantScoped: true, audit: false, softDelete: false },
  ListingChannelAccount: {
    tenantScoped: true,
    audit: true,
    softDelete: false,
    excludeFromDiff: ['accessTokenEnc', 'refreshTokenEnc'],
  },
  PropertyListing: { tenantScoped: true, audit: true, softDelete: false },

  // Cobros (Fase 11): todo es plata, con historial y sin borrado lógico (se
  // anula con registro, nunca se borra). El detalle diario del punitorio se
  // escribe de una vez al saldar la cuota: la fila misma es la traza.
  Installment: { tenantScoped: true, audit: true, softDelete: false },
  InstallmentCharge: { tenantScoped: true, audit: true, softDelete: false },
  Payment: { tenantScoped: true, audit: true, softDelete: false },
  InstallmentLateFeeDay: {
    tenantScoped: true,
    audit: false,
    softDelete: false,
  },
  LateFeeAdjustment: { tenantScoped: true, audit: true, softDelete: false },
  RenterCredit: { tenantScoped: true, audit: true, softDelete: false },
  // Devolución del depósito (Fase 12): una por contrato, con historial; sus
  // deducciones se escriben una vez con ella y la fila es la traza.
  DepositReturn: { tenantScoped: true, audit: true, softDelete: false },
  DepositReturnDeduction: {
    tenantScoped: true,
    audit: false,
    softDelete: false,
  },

  // Liquidaciones (Fase 12): plata, con historial y sin borrado lógico. Las
  // líneas (pagos y gastos incluidos) y los totales del consolidado son
  // snapshots que se reescriben en cada recálculo: la fila es la traza. Las
  // imputaciones de un pago de honorarios se escriben una vez con él.
  Settlement: { tenantScoped: true, audit: true, softDelete: false },
  SettlementPayment: { tenantScoped: true, audit: false, softDelete: false },
  SettlementExpense: { tenantScoped: true, audit: false, softDelete: false },
  SettlementAdjustment: { tenantScoped: true, audit: true, softDelete: false },
  SettlementTransfer: { tenantScoped: true, audit: true, softDelete: false },
  OwnerStatement: { tenantScoped: true, audit: true, softDelete: false },
  OwnerStatementTotal: { tenantScoped: true, audit: false, softDelete: false },
  FeeReceivable: { tenantScoped: true, audit: true, softDelete: false },
  FeePayment: { tenantScoped: true, audit: true, softDelete: false },
  FeePaymentAllocation: {
    tenantScoped: true,
    audit: false,
    softDelete: false,
  },

  // Automatizaciones (Fase 13): el registro de cada corrida y el historial de
  // avisos son su propia traza; auditarlos duplicaría cada fila. `JobExecution`
  // tiene `tenantId` opcional (los jobs globales no tienen inmobiliaria), así
  // que no pasa por el filtro: quien lee filtra a mano.
  JobExecution: { audit: false, softDelete: false },
  NotificationLog: { tenantScoped: true, audit: false, softDelete: false },
  // Claves de idempotencia: traza técnica de cada POST, sin auditoría.
  IdempotencyKey: { tenantScoped: true, audit: false, softDelete: false },

  // Notificaciones (Fase 14): plantillas, configuración por tipo y mensajes de
  // WhatsApp son decisiones de la inmobiliaria, con historial. Las preferencias
  // personales y los eventos del proveedor son ruido para la auditoría: el log
  // de envíos (notification_log) ya es la traza.
  NotificationTemplate: { tenantScoped: true, audit: true, softDelete: false },
  NotificationSetting: { tenantScoped: true, audit: true, softDelete: false },
  WhatsAppTemplate: { tenantScoped: true, audit: true, softDelete: false },
  NotificationUserPreference: {
    tenantScoped: true,
    audit: false,
    softDelete: false,
  },
  EmailEvent: { tenantScoped: true, audit: false, softDelete: false },

  // PDFs (Fase 15): cada versión es una fila; el historial dice quién pidió
  // la regeneración. El snapshot de datos es grande y ya vive en la fila, así
  // que no va al diff.
  GeneratedDocument: {
    tenantScoped: true,
    audit: true,
    softDelete: false,
    excludeFromDiff: ['dataSnapshot'],
  },

  // Los refresh tokens no se auditan ni se borran lógicamente: son efímeros,
  // se rotan constantemente y el cron los borra de verdad a los 30 días.
  // Auditarlos generaría una fila de historial por cada refresh.
  RefreshToken: { audit: false, softDelete: false },

  // Migración de datos (Fase 21): el lote se audita (cada paso del flujo queda
  // en el historial); sus filas, vínculos y fotos son staging o bitácora técnica
  // y las altas reales se auditan en el módulo de cada entidad.
  ImportBatch: { tenantScoped: true, audit: true, softDelete: false },
  ImportRow: { tenantScoped: true, audit: false, softDelete: false },
  ImportLink: { tenantScoped: true, audit: false, softDelete: false },
  ImportAssetResult: { tenantScoped: true, audit: false, softDelete: false },

  // Tasación (Fase 24). Los comparables, las zonas y el estado de las fuentes
  // son del mercado, iguales para todas las inmobiliarias: sin tenant (D-173) y
  // sin auditoría (los escribe el job, y cada fila dice cuándo se vio). La
  // tasación sí es de la inmobiliaria, con historial y sin borrado.
  MarketComparable: { tenantScoped: false, audit: false, softDelete: false },
  ValuationZone: { tenantScoped: false, audit: false, softDelete: false },
  ValuationSourceState: {
    tenantScoped: false,
    audit: false,
    softDelete: false,
  },
  ValuationRequest: { tenantScoped: true, audit: true, softDelete: false },

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
