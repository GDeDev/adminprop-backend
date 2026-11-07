/**
 * Chequeo de duplicados previo a los índices únicos de la auditoría de datos
 * (M7). Un `CREATE UNIQUE INDEX` falla si ya hay filas repetidas, y en
 * producción eso se descubriría a mitad de un deploy. La migración
 * `20261110120000_add_missing_unique_constraints` corre estas mismas
 * consultas antes de crear nada y aborta, sin tocar el esquema, con la lista
 * de lo que hay que limpiar. Este módulo permite correrlas *antes* de
 * desplegar (`npm run db:check-duplicates`).
 */
export interface UniqueCheck {
  /** Nombre del índice único que se va a crear. */
  index: string
  table: string
  /** Columnas del único, en la base (snake_case). */
  columns: string[]
  /** Predicado de un índice parcial; si no, el único vale para toda la tabla. */
  where?: string
}

export const UNIQUE_CHECKS: UniqueCheck[] = [
  {
    index: 'contract_rent_updates_contract_id_effective_from_key',
    table: 'contract_rent_updates',
    columns: ['contract_id', 'effective_from'],
  },
  {
    index: 'renter_credits_tenant_id_origin_payment_id_key',
    table: 'renter_credits',
    columns: ['tenant_id', 'origin_payment_id'],
  },
  {
    index: 'settlements_tenant_id_contract_id_period_sequence_key',
    table: 'settlements',
    columns: ['tenant_id', 'contract_id', 'period', 'sequence'],
  },
  {
    index: 'fee_payment_allocations_fee_payment_id_fee_receivable_id_key',
    table: 'fee_payment_allocations',
    columns: ['fee_payment_id', 'fee_receivable_id'],
  },
  {
    index: 'owners_portal_user_id_key',
    table: 'owners',
    columns: ['portal_user_id'],
    where: 'portal_user_id IS NOT NULL',
  },
  {
    index: 'renters_portal_user_id_key',
    table: 'renters',
    columns: ['portal_user_id'],
    where: 'portal_user_id IS NOT NULL',
  },
]

/**
 * SELECT que devuelve un grupo por cada combinación repetida, con cuántas
 * filas la comparten. Vacío = el único se puede crear.
 */
export function duplicatesSql(check: UniqueCheck): string {
  const cols = check.columns.map((c) => `"${c}"`).join(', ')
  const where = check.where ? ` WHERE ${check.where}` : ''
  return (
    `SELECT ${cols}, count(*)::int AS rows FROM "${check.table}"${where} ` +
    `GROUP BY ${cols} HAVING count(*) > 1 ORDER BY count(*) DESC, ${cols}`
  )
}

export interface DuplicateGroup {
  check: UniqueCheck
  groups: Record<string, unknown>[]
}

/** Lo mínimo que se necesita de un cliente: Prisma (`$queryRawUnsafe`) lo cumple. */
export interface RawQuerier {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>
}

export async function findUniqueDuplicates(
  db: RawQuerier,
  checks: UniqueCheck[] = UNIQUE_CHECKS,
): Promise<DuplicateGroup[]> {
  const found: DuplicateGroup[] = []
  for (const check of checks) {
    const groups = await db.$queryRawUnsafe<Record<string, unknown>[]>(
      duplicatesSql(check),
    )
    if (groups.length > 0) found.push({ check, groups })
  }
  return found
}
