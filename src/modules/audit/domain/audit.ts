import type { AuditAction, AuditActorKind } from '@/shared/audit/audit-event'
import { PageArgs } from '@/shared/pagination'

export type { AuditAction, AuditActorKind }

/** Una fila de `audit_logs` tal como la ve el dominio. */
export interface AuditRecord {
  id: string
  entity: string
  entityId: string | null
  action: AuditAction
  /** Lo que escribió quien registró el evento; null en el diff automático. */
  summary: string | null
  /** `{ campo: { before?, after? } }`. */
  changes: Record<string, { before?: unknown; after?: unknown }> | null
  actorKind: AuditActorKind
  userId: string | null
  userEmail: string | null
  ip: string | null
  createdAt: Date
}

export interface AuditFilter {
  entity?: string
  entityId?: string
  action?: AuditAction
  userId?: string
  actorKind?: AuditActorKind
  /** Instantes, ya resueltos desde las fechas del request. */
  from?: Date
  to?: Date
  /** Sobre `summary`, `entity`, `entityId` y el email del usuario. */
  search?: string
}

/**
 * Puerto de lectura de la auditoría. Dentro del tenant del contexto: las
 * filas globales (sin tenant) no las ve ninguna inmobiliaria. No hay
 * escritura acá —la inmutabilidad la garantiza la base— sino en `AuditFacade`.
 */
export abstract class AuditLogRepository {
  /** Más nuevas primero. */
  abstract page(
    filter: AuditFilter,
    page: PageArgs,
  ): Promise<[AuditRecord[], number]>

  /** Para exportar: las más nuevas primero, hasta `max`. */
  abstract listForExport(
    filter: AuditFilter,
    max: number,
  ): Promise<AuditRecord[]>

  abstract findById(id: string): Promise<AuditRecord | null>

  /** El historial de una entidad, más nuevo primero. */
  abstract historyOf(
    entity: string,
    entityId: string,
    limit: number,
  ): Promise<AuditRecord[]>

  /** Entidades que figuran en el historial de la inmobiliaria. */
  abstract distinctEntities(): Promise<string[]>
}

/** Nombre en español de cada entidad auditada (también el catálogo de filtros). */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  Tenant: 'inmobiliaria',
  User: 'usuario',
  Location: 'localidad',
  PropertyType: 'tipo de propiedad',
  Amenity: 'comodidad',
  OperationType: 'tipo de operación',
  ServiceType: 'tipo de servicio',
  Property: 'propiedad',
  Owner: 'propietario',
  Renter: 'inquilino',
  Guarantor: 'garante',
  Contract: 'contrato',
  ContractBillingTerms: 'condiciones de cobro del contrato',
  PropertyService: 'servicio de la propiedad',
  AdvanceExpense: 'gasto adelantado',
  Installment: 'cuota',
  InstallmentCharge: 'cargo de la cuota',
  Payment: 'pago',
  LateFeeAdjustment: 'ajuste de punitorio',
  RenterCredit: 'saldo a favor',
  DepositReturn: 'devolución de depósito',
  DepositReturnDeduction: 'descuento del depósito',
  Settlement: 'liquidación',
  SettlementAdjustment: 'ajuste de liquidación',
  SettlementTransfer: 'transferencia al propietario',
  OwnerStatement: 'consolidado',
  FeeReceivable: 'honorario a cobrar',
  FeePayment: 'pago de honorarios',
  GeneratedDocument: 'documento',
  Notification: 'aviso',
  Job: 'tarea automática',
  Report: 'reporte',
  Audit: 'auditoría',
}
