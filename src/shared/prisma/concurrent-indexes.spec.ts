import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../../../prisma')
const schema = readFileSync(join(ROOT, 'schema.prisma'), 'utf8')

const migrations = readdirSync(join(ROOT, 'migrations'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    name: entry.name,
    sql: readFileSync(
      join(ROOT, 'migrations', entry.name, 'migration.sql'),
      'utf8',
    ),
  }))

/** El SQL sin comentarios de línea, para contar sentencias. */
const statements = (sql: string): string[] =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * Índices sobre tablas grandes (auditoría de datos, M3 y M11). Prisma envuelve
 * en una transacción una migración con varias sentencias, y
 * CREATE INDEX CONCURRENTLY no puede correr dentro de una: tiene que ser la
 * única sentencia de su archivo.
 */
describe('índices CONCURRENTLY', () => {
  const concurrent = migrations.filter(({ sql }) =>
    /CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(sql),
  )

  it.each([
    ['payments_tenant_id_status_paid_at_idx', 'payments'],
    ['installments_tenant_id_grace_end_date_unpaid_idx', 'installments'],
    ['audit_logs_tenant_id_action_created_at_idx', 'audit_logs'],
  ])('%s existe, sobre %s, en una migración propia', (index, table) => {
    const owner = concurrent.filter(({ sql }) => sql.includes(`"${index}"`))
    expect(owner).toHaveLength(1)
    expect(owner[0].sql).toContain(`ON "${table}"`)
  })

  it('cada migración con CONCURRENTLY tiene una sola sentencia', () => {
    expect(concurrent.length).toBeGreaterThanOrEqual(3)
    for (const { name, sql } of concurrent) {
      expect({ name, count: statements(sql).length }).toEqual({
        name,
        count: 1,
      })
    }
  })

  it('los índices comunes del schema los declara Prisma, para que migrate dev no los vea como deriva', () => {
    expect(schema).toMatch(/@@index\(\[tenantId, status, paidAt\]\)/)
    expect(schema).toMatch(
      /@@index\(\[tenantId, action, createdAt\(sort: Desc\)\]\)/,
    )
  })
})
