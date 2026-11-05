import { PrismaClient } from '@prisma/client'

import { TEST_DATABASE_URL } from './utils/test-database-url'

/**
 * Un CREATE INDEX CONCURRENTLY que falla deja el índice INVALID, que no se usa
 * pero sí se mantiene en cada escritura. Si la base de tests lo tiene válido,
 * la migración corrió entera.
 */
describe('Índices CONCURRENTLY (e2e, Postgres)', () => {
  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL })
  afterAll(() => prisma.$disconnect())

  const indexes = [
    ['payments_tenant_id_status_paid_at_idx', /\(tenant_id, status, paid_at\)/],
    [
      'installments_tenant_id_grace_end_date_unpaid_idx',
      /\(tenant_id, grace_end_date\) WHERE \(status <> 'PAID'/,
    ],
    [
      'audit_logs_tenant_id_action_created_at_idx',
      /\(tenant_id, action, created_at DESC\)/,
    ],
  ] as const

  it.each(indexes)(
    '%s es válido y tiene la forma esperada',
    async (name, def) => {
      const rows = await prisma.$queryRaw<
        { indexdef: string; valid: boolean }[]
      >`
      SELECT pg_indexes.indexdef, pg_index.indisvalid AS valid
      FROM pg_indexes
      JOIN pg_class ON pg_class.relname = pg_indexes.indexname
      JOIN pg_index ON pg_index.indexrelid = pg_class.oid
      WHERE pg_indexes.schemaname = 'public' AND pg_indexes.indexname = ${name}
    `
      expect(rows).toHaveLength(1)
      expect(rows[0].valid).toBe(true)
      expect(rows[0].indexdef).toMatch(def)
    },
  )
})
