import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { TEST_DATABASE_URL } from './utils/test-database-url'

const migration = (name: string) =>
  readFileSync(
    join(__dirname, `../prisma/migrations/${name}/migration.sql`),
    'utf8',
  )

/**
 * CHECK de bajo riesgo de la auditoría de datos (M7). Cada caso toma la
 * constraint real de la base, la copia a una tabla temporal (sin las columnas
 * obligatorias, que no son lo que se prueba) y comprueba que una fila inválida
 * se rechaza y una válida pasa.
 */
interface Case {
  constraint: string
  table: string
  /** `columnas` y `valores` SQL de una fila que viola la constraint. */
  bad: [string, string]
  good: [string, string]
}

const CASES: Case[] = [
  {
    constraint: 'contracts_dates_check',
    table: 'contracts',
    bad: ['start_date, end_date', `'2026-06-01', '2026-06-01'`],
    good: ['start_date, end_date', `'2026-06-01', '2026-06-02'`],
  },
  {
    constraint: 'contracts_amounts_check',
    table: 'contracts',
    bad: ['initial_rent, deposit', `100, -1`],
    good: ['initial_rent, deposit', `100, 0`],
  },
  {
    constraint: 'contracts_fee_percentage_check',
    table: 'contracts',
    bad: ['fee_percentage', '100.01'],
    good: ['fee_percentage', '100'],
  },
  {
    constraint: 'contracts_fixed_increase_percentage_check',
    table: 'contracts',
    bad: ['fixed_increase_percentage', '-0.01'],
    good: ['fixed_increase_percentage', 'NULL'],
  },
  {
    constraint: 'contract_rent_updates_new_rent_check',
    table: 'contract_rent_updates',
    bad: ['new_rent', '-1'],
    good: ['new_rent', '1'],
  },
  {
    constraint: 'contract_billing_terms_fee_percentage_check',
    table: 'contract_billing_terms',
    bad: ['fee_percentage', '101'],
    good: ['fee_percentage', '5'],
  },
  {
    constraint: 'contract_billing_terms_fee_amount_check',
    table: 'contract_billing_terms',
    bad: ['fee_amount', '0'],
    good: ['fee_amount', '1500.50'],
  },
  {
    constraint: 'installments_period_check',
    table: 'installments',
    bad: ['period', `'2026-13'`],
    good: ['period', `'2026-12'`],
  },
  {
    constraint: 'installments_period_check',
    table: 'installments',
    bad: ['period', `'2026-1'`],
    good: ['period', `'2026-01'`],
  },
  {
    constraint: 'installments_base_amount_check',
    table: 'installments',
    bad: ['base_amount', '-5'],
    good: ['base_amount', '0'],
  },
  {
    constraint: 'installment_charges_amount_check',
    table: 'installment_charges',
    bad: ['amount', '0'],
    good: ['amount', '0.01'],
  },
  {
    constraint: 'installment_late_fee_days_values_check',
    table: 'installment_late_fee_days',
    bad: ['day_number, amount', '0, 10'],
    good: ['day_number, amount', '1, 0'],
  },
  {
    constraint: 'late_fee_adjustments_amount_check',
    table: 'late_fee_adjustments',
    bad: ['amount', '-1'],
    good: ['amount', '0'],
  },
  {
    constraint: 'payments_amount_check',
    table: 'payments',
    bad: ['amount, amount_in_contract_currency', '0, 10'],
    good: ['amount, amount_in_contract_currency', '10, 0'],
  },
  {
    constraint: 'payments_applied_check',
    table: 'payments',
    bad: [
      'late_fee_applied, rent_applied, charges_applied, credit_generated',
      '0, 0, -1, 0',
    ],
    good: [
      'late_fee_applied, rent_applied, charges_applied, credit_generated',
      '0, 10, 0, 0',
    ],
  },
  {
    constraint: 'payments_exchange_rate_check',
    table: 'payments',
    bad: ['exchange_rate, exchange_rate_source', `1200, NULL`],
    good: ['exchange_rate, exchange_rate_source', `1200, 'MEP'`],
  },
  {
    constraint: 'renter_credits_remaining_check',
    table: 'renter_credits',
    bad: ['amount, remaining', '100, 100.01'],
    good: ['amount, remaining', '100, 0'],
  },
  {
    constraint: 'renter_credits_remaining_check',
    table: 'renter_credits',
    bad: ['amount, remaining', '100, -1'],
    good: ['amount, remaining', '100, 100'],
  },
  {
    constraint: 'settlements_period_check',
    table: 'settlements',
    bad: ['period', `'2026-00'`],
    good: ['period', `'2026-10'`],
  },
  {
    constraint: 'settlements_sequence_check',
    table: 'settlements',
    bad: ['sequence', '0'],
    good: ['sequence', '1'],
  },
  {
    constraint: 'fee_receivables_period_check',
    table: 'fee_receivables',
    bad: ['period', `'202610'`],
    good: ['period', `'2026-10'`],
  },
  {
    constraint: 'fee_receivables_paid_amount_check',
    table: 'fee_receivables',
    bad: ['amount, paid_amount', '100, 150'],
    good: ['amount, paid_amount', '100, 100'],
  },
]

describe('CHECK constraints de la auditoría (e2e, Postgres)', () => {
  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL })

  afterAll(() => prisma.$disconnect())

  /**
   * Corre `fn` en una transacción que siempre se deshace, con una tabla
   * temporal con las constraints de la real y todas las columnas opcionales.
   */
  const withScratchTable = async (
    table: string,
    fn: (tx: PrismaClient) => Promise<void>,
  ) => {
    const rollback = new Error('rollback')
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `CREATE TEMP TABLE "scratch" (LIKE "public"."${table}" INCLUDING CONSTRAINTS) ON COMMIT DROP`,
        )
        const columns = await tx.$queryRawUnsafe<{ attname: string }[]>(
          `SELECT attname FROM pg_attribute WHERE attrelid = 'pg_temp.scratch'::regclass AND attnum > 0 AND NOT attisdropped`,
        )
        for (const { attname } of columns) {
          await tx.$executeRawUnsafe(
            `ALTER TABLE "scratch" ALTER COLUMN "${attname}" DROP NOT NULL`,
          )
        }
        await fn(tx as unknown as PrismaClient)
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
  }

  const insert = (tx: PrismaClient, [columns, values]: [string, string]) =>
    tx.$executeRawUnsafe(
      `INSERT INTO "scratch" (${columns}) VALUES (${values})`,
    )

  it.each(CASES)(
    '$constraint rechaza $bad y acepta $good',
    async ({ constraint, table, bad, good }) => {
      await withScratchTable(table, async (tx) => {
        await expect(insert(tx, bad)).rejects.toThrow(new RegExp(constraint))
      })
      // El rechazo aborta la transacción; el caso válido va en otra.
      await withScratchTable(table, async (tx) => {
        await expect(insert(tx, good)).resolves.toBe(1)
      })
    },
  )

  it('todas las constraints existen en la base y quedaron validadas', async () => {
    const names = [...new Set(CASES.map((c) => c.constraint))]
    const rows = await prisma.$queryRawUnsafe<
      { conname: string; convalidated: boolean }[]
    >(
      `SELECT conname, convalidated FROM pg_constraint
       WHERE contype = 'c' AND connamespace = 'public'::regnamespace`,
    )
    const byName = new Map(rows.map((r) => [r.conname, r.convalidated]))
    for (const name of names) expect(byName.get(name)).toBe(true)
    // Y no hay otra CHECK sin que un caso la pruebe.
    const sql = migration('20261110130000_add_check_constraints')
    const declared = [...sql.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map(
      (m) => m[1],
    )
    expect(declared.sort()).toEqual(names.sort())
  })

  it('los CHECK siguen rechazando en la tabla real, no sólo en la copia', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "installment_late_fee_days" ("id", "tenant_id", "installment_id", "day", "day_number", "outstanding_base", "daily_percentage", "amount")
         VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '2026-01-01', 0, 1, 1, 1)`,
      ),
    ).rejects.toThrow(/installment_late_fee_days_values_check|foreign key/)
  })

  describe('la migración de validación', () => {
    const validate = migration('20261110131000_validate_check_constraints')

    it('valida lo que cumple y deja NOT VALID, con aviso, lo que no', async () => {
      const rollback = new Error('rollback')
      const notices: string[] = []
      try {
        await prisma.$transaction(async (tx) => {
          // Una constraint nueva, NOT VALID, sobre una fila vieja que la viola.
          await tx.$executeRawUnsafe(
            `CREATE TABLE "public"."validate_probe" (n int)`,
          )
          await tx.$executeRawUnsafe(`INSERT INTO "validate_probe" VALUES (-1)`)
          await tx.$executeRawUnsafe(
            `ALTER TABLE "validate_probe" ADD CONSTRAINT "validate_probe_bad_check" CHECK (n >= 0) NOT VALID`,
          )
          await tx.$executeRawUnsafe(
            `ALTER TABLE "validate_probe" ADD CONSTRAINT "validate_probe_ok_check" CHECK (n < 10) NOT VALID`,
          )

          // No debe tirar: el deploy no se cae por datos viejos.
          await tx.$executeRawUnsafe(validate)

          const rows = await tx.$queryRawUnsafe<
            { conname: string; convalidated: boolean }[]
          >(
            `SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE 'validate_probe_%'`,
          )
          notices.push(
            ...rows.map((r) => `${r.conname}=${String(r.convalidated)}`),
          )
          // Sigue rechazando escrituras nuevas aunque no esté validada.
          await expect(
            tx.$executeRawUnsafe(`INSERT INTO "validate_probe" VALUES (-5)`),
          ).rejects.toThrow(/validate_probe_bad_check/)
          throw rollback
        })
      } catch (error) {
        if (error !== rollback) throw error
      }
      expect(notices.sort()).toEqual([
        'validate_probe_bad_check=false',
        'validate_probe_ok_check=true',
      ])
    })
  })
})
