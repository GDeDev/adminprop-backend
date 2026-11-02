import { Injectable } from '@nestjs/common'

import { formatMoney } from '@/shared/money'
import { AUDIT_ENTITY_LABELS, AuditRecord } from '../domain/audit'
import { AuditNameResolver, EntityRef, refKey } from './audit-name-resolver'

/** Entidades cuyo nombre sale de una facade. */
const NAMED_ENTITIES = new Set([
  'Property',
  'Owner',
  'Renter',
  'Contract',
  'User',
])

const VERBS: Record<string, string> = {
  CREATE: 'Creó',
  UPDATE: 'Modificó',
  DELETE: 'Eliminó',
  RESTORE: 'Restauró',
}

/** Nombre en español de los campos que más se editan; el resto sale tal cual. */
const FIELD_LABELS: Record<string, string> = {
  status: 'estado',
  address: 'dirección',
  firstName: 'nombre',
  lastName: 'apellido',
  email: 'email',
  phone: 'teléfono',
  amount: 'importe',
  baseAmount: 'alquiler base',
  rent: 'alquiler',
  endDate: 'fecha de fin',
  startDate: 'fecha de inicio',
  notes: 'notas',
  deletedAt: 'baja',
  feePercentage: 'porcentaje de honorarios',
  isActive: 'activo',
  role: 'rol',
}

/** Cuántos campos modificados se nombran en la frase. */
const MAX_FIELDS = 3

function after(record: AuditRecord, field: string): unknown {
  return record.changes?.[field]?.after
}

/**
 * Arma la frase legible de cada fila del historial (Fase 20, 5): "Registró un
 * pago de $ 100.000,00", "Modificó el contrato Calle 1 100 - Ana López
 * (estado)". Las filas de evento ya traen la suya; el diff automático de
 * Prisma no conoce los nombres, así que se resuelven acá, al leer, por las
 * facades (D-116: no se guarda de vuelta porque la tabla es inmutable).
 */
@Injectable()
export class AuditSummarizer {
  constructor(private readonly names: AuditNameResolver) {}

  async summarize(records: AuditRecord[]): Promise<Map<string, string>> {
    const refs: EntityRef[] = records
      .filter(
        (r) =>
          !r.summary && r.entityId !== null && NAMED_ENTITIES.has(r.entity),
      )
      .map((r) => ({ entity: r.entity, id: r.entityId as string }))
    const names = await this.names.resolve(refs)

    return new Map(
      records.map((record) => [
        record.id,
        record.summary ?? this.build(record, names),
      ]),
    )
  }

  build(record: AuditRecord, names: Map<string, string>): string {
    switch (record.action) {
      case 'LOGIN':
        return 'Inició sesión'
      case 'LOGIN_FAILED':
        return 'Intento de inicio de sesión fallido'
      case 'LOGOUT':
        return 'Cerró sesión'
      case 'NOTIFICATION_SENT':
        return 'Se envió un aviso'
      case 'JOB_RUN':
        return 'Ejecutó una tarea automática'
      case 'EXPORT':
        return 'Exportó un reporte'
      default:
        return this.buildChange(record, names)
    }
  }

  private buildChange(record: AuditRecord, names: Map<string, string>): string {
    const verb = VERBS[record.action] ?? 'Modificó'

    if (record.entity === 'Payment' && record.action === 'CREATE') {
      const amount = after(record, 'amount')
      const currency = after(record, 'paidCurrency')
      if (typeof amount === 'string' || typeof amount === 'number') {
        return `Registró un pago de ${money(amount, currency)}`
      }
    }

    const label = AUDIT_ENTITY_LABELS[record.entity] ?? record.entity
    const name = this.nameOf(record, names)
    const base = `${verb} ${article(label)} ${label}${name ? ` ${name}` : ''}`

    if (record.action !== 'UPDATE' || !record.changes) return base
    const fields = Object.keys(record.changes)
      .map((field) => FIELD_LABELS[field] ?? field)
      .slice(0, MAX_FIELDS)
    const more = Object.keys(record.changes).length - fields.length
    return fields.length > 0
      ? `${base} (${fields.join(', ')}${more > 0 ? ` y ${more} más` : ''})`
      : base
  }

  private nameOf(
    record: AuditRecord,
    names: Map<string, string>,
  ): string | null {
    if (record.entityId && NAMED_ENTITIES.has(record.entity)) {
      return names.get(refKey(record.entity, record.entityId)) ?? null
    }
    const period = after(record, 'period')
    if (
      (record.entity === 'Installment' || record.entity === 'Settlement') &&
      typeof period === 'string'
    ) {
      return period
    }
    return null
  }
}

/** Artículo del sustantivo: los femeninos de las etiquetas terminan en a, ad, ión o es. */
function article(label: string): string {
  const first = label.split(' ')[0]
  return /(a|ad|ión|es)$/.test(first) ? 'la' : 'el'
}

function money(amount: string | number, currency: unknown): string {
  return formatMoney(String(amount), currency === 'USD' ? 'USD' : 'ARS')
}
