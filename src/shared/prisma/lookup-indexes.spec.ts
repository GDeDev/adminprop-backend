import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../../../prisma')
const migrations = readdirSync(join(ROOT, 'migrations'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) =>
    readFileSync(join(ROOT, 'migrations', entry.name, 'migration.sql'), 'utf8'),
  )
  .join('\n')
const schema = readFileSync(join(ROOT, 'schema.prisma'), 'utf8')

/**
 * Índices de búsqueda de la auditoría de datos. Se declaran en el schema (así
 * `migrate dev` no los toma por deriva y los borra) y los crea una migración.
 */
describe('índices de búsqueda', () => {
  const expected = [
    ['job_executions_scheduled_for_idx', 'job_executions', 'scheduled_for'],
    ['owners_portal_user_id_idx', 'owners', 'portal_user_id'],
    ['renters_portal_user_id_idx', 'renters', 'portal_user_id'],
  ]

  it.each(expected)('%s lo crea una migración', (name, table, column) => {
    expect(migrations).toContain(
      `CREATE INDEX "${name}" ON "${table}"("${column}")`,
    )
  })

  it('el schema los declara para que Prisma no los vea como deriva', () => {
    expect(schema).toMatch(/@@index\(\[scheduledFor\]\)/)
    expect(schema.match(/@@index\(\[portalUserId\]\)/g)).toHaveLength(2)
  })

  it('el único parcial de corridas programadas existe y no se borra', () => {
    // Vive sólo en SQL (Prisma no declara índices parciales con expresión).
    const create = migrations.indexOf(
      'CREATE UNIQUE INDEX "job_executions_scheduled_slot_key"',
    )
    expect(create).toBeGreaterThan(-1)
    expect(migrations.slice(create)).not.toContain(
      'DROP INDEX "job_executions_scheduled_slot_key"',
    )
  })
})
