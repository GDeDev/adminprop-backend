import { RequestContext } from '../src/shared/context/request-context'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTenant, resetDatabase } from './utils/database'
import { TEST_DATABASE_URL } from './utils/test-database-url'

/**
 * El soft delete (`delete` -> `update` de `deletedAt`) dentro de
 * `PrismaService.transaction()`. Se usa ExampleItem: modelo con tenant,
 * auditado y con borrado lógico. Antes la escritura derivada iba por el
 * cliente global y quedaba fuera de la transacción.
 */
describe('Soft delete dentro de transacciones (e2e, Postgres)', () => {
  // Pool de 2 conexiones a propósito: es lo que hace visible el problema.
  const originalUrl = process.env.DATABASE_URL
  let prisma: PrismaService
  let tenant: { id: string }

  const inTenant = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ correlationId: 'tx-soft-delete' }, () =>
      RequestContext.runInTenant(tenant.id, fn),
    )

  /** El registro como está en la base, borrado o no (cliente sin extensiones). */
  const rawItem = (id: string) =>
    prisma.exampleItem.findUniqueOrThrow({ where: { id } })

  const createItem = (name = 'Casa') =>
    inTenant(() =>
      prisma.db.exampleItem.create({
        data: { tenantId: tenant.id, name, price: '100.00' },
      }),
    )

  const deleteAudits = () =>
    prisma.auditLog.count({
      where: { tenantId: tenant.id, entity: 'ExampleItem', action: 'DELETE' },
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
    tenant = await createTenant(prisma, 'tx-soft-delete')
  })

  it('fuera de una transacción el delete marca deletedAt y queda en el historial', async () => {
    const item = await createItem()

    await inTenant(() =>
      prisma.db.exampleItem.delete({ where: { id: item.id } }),
    )

    expect((await rawItem(item.id)).deletedAt).not.toBeNull()
    expect(await deleteAudits()).toBe(1)
  })

  it('un rollback deshace el borrado lógico', async () => {
    // Antes el UPDATE de deletedAt corría con el cliente global, fuera de la
    // transacción: sobrevivía al rollback.
    const item = await createItem()

    await expect(
      inTenant(() =>
        prisma.transaction(async () => {
          await prisma.db.exampleItem.delete({ where: { id: item.id } })
          throw new Error('rollback a propósito')
        }),
      ),
    ).rejects.toThrow('rollback a propósito')

    expect((await rawItem(item.id)).deletedAt).toBeNull()
    expect(await deleteAudits()).toBe(0)
  })

  it('un deleteMany también se deshace con el rollback', async () => {
    const item = await createItem()

    await expect(
      inTenant(() =>
        prisma.transaction(async () => {
          await prisma.db.exampleItem.deleteMany({ where: { id: item.id } })
          throw new Error('rollback a propósito')
        }),
      ),
    ).rejects.toThrow('rollback a propósito')

    expect((await rawItem(item.id)).deletedAt).toBeNull()
  })

  it('borrar lo que creó la misma transacción lo marca, no lo elimina de verdad', async () => {
    // Antes el registro actual se leía con el cliente global, que no ve lo
    // escrito sin confirmar: no lo encontraba y el delete terminaba siendo
    // físico.
    const id = await inTenant(() =>
      prisma.transaction(async () => {
        const created = await prisma.db.exampleItem.create({
          data: { tenantId: tenant.id, name: 'Efímera', price: '1.00' },
        })
        await prisma.db.exampleItem.delete({ where: { id: created.id } })
        return created.id
      }),
    )

    expect((await rawItem(id)).deletedAt).not.toBeNull()
    expect(await deleteAudits()).toBe(1)
  })

  it('confirmada la transacción, el borrado y su historial quedan', async () => {
    const item = await createItem()

    await inTenant(() =>
      prisma.transaction(async () => {
        await prisma.db.exampleItem.delete({ where: { id: item.id } })
        // Dentro de la misma transacción ya no se lo ve.
        expect(
          await prisma.db.exampleItem.findFirst({ where: { id: item.id } }),
        ).toBeNull()
      }),
    )

    expect((await rawItem(item.id)).deletedAt).not.toBeNull()
    expect(await deleteAudits()).toBe(1)
  })

  it('más transacciones con borrados que conexiones no se traban esperando otra conexión', async () => {
    const items = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createItem(`Casa ${i}`)),
    )

    await Promise.all(
      items.map((item) =>
        inTenant(() =>
          prisma.transaction(async () => {
            await prisma.db.exampleItem.delete({ where: { id: item.id } })
          }),
        ),
      ),
    )

    for (const item of items) {
      expect((await rawItem(item.id)).deletedAt).not.toBeNull()
    }
  })
})
