import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(__dirname, '../../../../../prisma/migrations')
const INDEX = 'site_settings_custom_domain_verified_key'

/**
 * El índice único PARCIAL de dominios verificados vive solo en SQL (Prisma no
 * puede declararlo). Si alguien corre `migrate dev`, Prisma puede generar una
 * migración que lo borre como "deriva" y dos inmobiliarias podrían verificar el
 * mismo dominio sin que nada falle. Este test hace visible esa regresión.
 */
describe('índice único parcial de dominios verificados', () => {
  const migrations = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'),
    }))

  it('lo crea una migración, como único y solo sobre los verificados', () => {
    const creators = migrations.filter((m) =>
      m.sql.includes(`CREATE UNIQUE INDEX "${INDEX}"`),
    )
    expect(creators.map((m) => m.name)).toEqual([
      '20261103160000_add_site_domain_verification',
    ])
    expect(creators[0]?.sql).toMatch(
      /WHERE "custom_domain_verified_at" IS NOT NULL/,
    )
  })

  it('ninguna migración posterior lo elimina', () => {
    const created = migrations.findIndex((m) =>
      m.sql.includes(`CREATE UNIQUE INDEX "${INDEX}"`),
    )
    const later = migrations.slice(created + 1)
    expect(
      later.filter((m) => m.sql.includes(`DROP INDEX "${INDEX}"`)),
    ).toEqual([])
  })

  it('el schema avisa que existe y que no hay que arreglarlo', () => {
    const schema = readFileSync(join(MIGRATIONS, '../schema.prisma'), 'utf8')
    expect(schema).toContain(INDEX)
    expect(schema).toMatch(/No lo "arregles"/)
  })
})
