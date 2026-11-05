import { RequestContext } from '../src/shared/context/request-context'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { TEST_DATABASE_URL } from './utils/test-database-url'
import { createTenant, resetDatabase } from './utils/database'

/**
 * La auditoría dentro de `PrismaService.transaction()`. Se usa ExampleItem:
 * modelo con tenant, auditado y con soft delete.
 */
describe('Auditoría dentro de transacciones (e2e, Postgres)', () => {
  // Pool de 2 conexiones a propósito: es lo que hace visible el problema.
  const originalUrl = process.env.DATABASE_URL
  let prisma: PrismaService
  let tenant: { id: string }

  const inTenant = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ correlationId: 'tx-audit' }, () =>
      RequestContext.runInTenant(tenant.id, fn),
    )

  const auditRows = () =>
    prisma.auditLog.findMany({
      where: { tenantId: tenant.id, entity: 'ExampleItem' },
      orderBy: { createdAt: 'asc' },
    })

  beforeAll(async () => {
    process.env.DATABASE_URL = `${TEST_DATABASE_URL}?connection_limit=2&pool_timeout=5`
    prisma = new PrismaService()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
    process.env.DATABASE_URL = originalUrl
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
    tenant = await createTenant(prisma, 'tx-audit')
  })

  it('un update sobre lo que creó la misma transacción queda en el historial', async () => {
    // Antes el "antes" se leía con otra conexión, que todavía no veía la fila
    // sin commitear: el diff salía vacío y el UPDATE no se registraba.
    await inTenant(() =>
      prisma.transaction(async () => {
        const item = await prisma.db.exampleItem.create({
          data: { tenantId: tenant.id, name: 'Casa', price: '100.00' },
        })
        await prisma.db.exampleItem.update({
          where: { id: item.id },
          data: { price: '250.00' },
        })
      }),
    )

    const rows = await auditRows()
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE'])
    expect(rows[1].changes).toMatchObject({
      price: { before: 100, after: 250 },
    })
  })

  it('si la transacción hace rollback no quedan filas de historial', async () => {
    await expect(
      inTenant(() =>
        prisma.transaction(async () => {
          await prisma.db.exampleItem.create({
            data: { tenantId: tenant.id, name: 'Fantasma', price: '1.00' },
          })
          throw new Error('rollback a propósito')
        }),
      ),
    ).rejects.toThrow('rollback a propósito')

    expect(await auditRows()).toEqual([])
  })

  it('más transacciones concurrentes que conexiones no se traban esperando una segunda conexión', async () => {
    // Pool de 2 y 6 transacciones con escrituras auditadas: con el cliente base
    // para el historial, cada transacción retenía una conexión y pedía otra, y
    // las que quedaban esperando vencían con P2024 (pool_timeout).
    const run = (i: number) =>
      inTenant(() =>
        prisma.transaction(async () => {
          const item = await prisma.db.exampleItem.create({
            data: { tenantId: tenant.id, name: `Item ${i}`, price: '10.00' },
          })
          await prisma.db.exampleItem.update({
            where: { id: item.id },
            data: { price: '20.00' },
          })
        }),
      )

    const results = await Promise.allSettled([0, 1, 2, 3, 4, 5].map(run))

    expect(results.filter((r) => r.status === 'rejected')).toEqual([])
    expect(await auditRows()).toHaveLength(12)
  })
})
