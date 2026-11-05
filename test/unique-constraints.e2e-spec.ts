import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import {
  duplicatesSql,
  findUniqueDuplicates,
  UNIQUE_CHECKS,
} from '../src/shared/prisma/constraints/unique-duplicates'
import { createTenant, resetDatabase } from './utils/database'
import { TEST_DATABASE_URL } from './utils/test-database-url'

const MIGRATION = readFileSync(
  join(
    __dirname,
    '../prisma/migrations/20261110120000_add_missing_unique_constraints/migration.sql',
  ),
  'utf8',
)
// El bloque de chequeo, tal cual lo corre la migración.
const GUARD = MIGRATION.slice(
  MIGRATION.indexOf('DO $$'),
  MIGRATION.indexOf('$$;') + 3,
)

/**
 * Únicos de la auditoría de datos (M7) y su chequeo previo de duplicados.
 * Una base con duplicados no puede recibir un único: el chequeo tiene que
 * encontrarlos antes y la migración abortar con un mensaje útil.
 */
describe('Índices únicos de la auditoría (e2e, Postgres)', () => {
  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL })

  afterAll(() => prisma.$disconnect())

  /** Tablas "espejo" con sólo las columnas de cada único, sin ningún índice. */
  const SCHEMA = 'dup_check'
  const makeScratch = async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`)
    for (const check of UNIQUE_CHECKS) {
      const columns = check.columns.map((c) => `"${c}" text`).join(', ')
      await prisma.$executeRawUnsafe(
        `CREATE TABLE ${SCHEMA}."${check.table}" (${columns})`,
      )
    }
  }

  /** Corre `fn` con el schema espejo primero en el search_path. */
  const inScratch = <T>(fn: (tx: PrismaClient) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path = ${SCHEMA}, public`)
      return fn(tx as unknown as PrismaClient)
    })

  describe('chequeo de duplicados', () => {
    beforeEach(makeScratch)
    afterAll(() =>
      prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`),
    )

    it('sin filas repetidas no informa nada', async () => {
      const found = await inScratch(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO "contract_rent_updates" VALUES ('c1', '2026-01-01'), ('c1', '2026-07-01'), ('c2', '2026-01-01')`,
        )
        return findUniqueDuplicates(tx)
      })
      expect(found).toEqual([])
    })

    it('informa cada combinación repetida con cuántas filas la comparten', async () => {
      const found = await inScratch(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO "contract_rent_updates" VALUES ('c1', '2026-01-01'), ('c1', '2026-01-01'), ('c1', '2026-01-01'), ('c2', '2026-01-01')`,
        )
        await tx.$executeRawUnsafe(
          `INSERT INTO "settlements" VALUES ('t', 'c', '2026-01', '1'), ('t', 'c', '2026-01', '1'), ('t', 'c', '2026-01', '2')`,
        )
        return findUniqueDuplicates(tx)
      })

      expect(found.map((f) => f.check.table)).toEqual([
        'contract_rent_updates',
        'settlements',
      ])
      expect(found[0].groups).toEqual([
        { contract_id: 'c1', effective_from: '2026-01-01', rows: 3 },
      ])
      expect(found[1].groups).toEqual([
        {
          tenant_id: 't',
          contract_id: 'c',
          period: '2026-01',
          sequence: '1',
          rows: 2,
        },
      ])
    })

    it('en los únicos parciales los NULL no cuentan como repetidos', async () => {
      const found = await inScratch(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO "owners" VALUES (NULL), (NULL), ('u1'), ('u2')`,
        )
        await tx.$executeRawUnsafe(
          `INSERT INTO "renters" VALUES ('u1'), ('u1')`,
        )
        return findUniqueDuplicates(tx)
      })
      expect(found.map((f) => f.check.table)).toEqual(['renters'])
    })

    it('la migración aborta con la lista completa si hay duplicados', async () => {
      const run = () =>
        inScratch(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "renter_credits" VALUES ('t', 'p'), ('t', 'p')`,
          )
          await tx.$executeRawUnsafe(`INSERT INTO "owners" VALUES ('u'), ('u')`)
          await tx.$executeRawUnsafe(GUARD)
        })

      await expect(run()).rejects.toThrow(
        /renter_credits \(tenant_id, origin_payment_id\): 1 combinaciones repetidas/,
      )
      await expect(run()).rejects.toThrow(/owners \(portal_user_id\): 1/)
      await expect(run()).rejects.toThrow(/npm run db:check-duplicates/)
    })

    it('la migración sigue de largo si no hay duplicados', async () => {
      await expect(
        inScratch(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "renter_credits" VALUES ('t', 'p1'), ('t', 'p2')`,
          )
          await tx.$executeRawUnsafe(GUARD)
        }),
      ).resolves.toBeUndefined()
    })

    it('la migración y el chequeo cubren los mismos únicos', () => {
      for (const check of UNIQUE_CHECKS) {
        expect(MIGRATION).toContain(`"${check.index}"`)
        expect(MIGRATION).toContain(check.table)
      }
      expect(duplicatesSql(UNIQUE_CHECKS[0])).toContain('HAVING count(*) > 1')
    })
  })

  describe('índices creados', () => {
    it.each(UNIQUE_CHECKS.map((c) => [c.index, c]))(
      '%s existe, es único y respeta el predicado',
      async (_name, check) => {
        const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
          SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = ${check.index}
        `
        expect(rows).toHaveLength(1)
        expect(rows[0].indexdef).toContain('CREATE UNIQUE INDEX')
        if (check.where) expect(rows[0].indexdef).toContain('WHERE')
        else expect(rows[0].indexdef).not.toContain('WHERE')
      },
    )
  })

  describe('portal_user_id único parcial', () => {
    const portalUser = '5d1b0000-0000-4000-8000-000000000001'
    const createOwner = (
      tenantId: string,
      nationalId: string,
      user: string | null,
    ) =>
      prisma.owner.create({
        data: {
          tenantId,
          firstName: 'Ana',
          lastName: 'Gómez',
          nationalId,
          searchName: 'ana gomez',
          portalUserId: user,
        },
      })

    beforeEach(() => resetDatabase(prisma))

    it('dos titulares no comparten usuario de portal, ni siquiera de otro tenant', async () => {
      const a = await createTenant(prisma as never, 'uq-a')
      const b = await createTenant(prisma as never, 'uq-b')
      await createOwner(a.id, '20111111112', portalUser)
      await expect(
        createOwner(b.id, '20111111113', portalUser),
      ).rejects.toThrow(/owners_portal_user_id_key|Unique constraint/)
    })

    it('los titulares sin portal (NULL) pueden ser todos los que haga falta', async () => {
      const a = await createTenant(prisma as never, 'uq-c')
      await createOwner(a.id, '20111111114', null)
      await expect(
        createOwner(a.id, '20111111115', null),
      ).resolves.toBeDefined()
    })
  })
})
